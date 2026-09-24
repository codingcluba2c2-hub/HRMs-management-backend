import { prisma } from '../../lib/prisma';

import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { sendEmail } from '../../utils/mailer';
import { OAuth2Client } from 'google-auth-library';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);



export const login = async (email: string, password: string) => {
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user) throw new Error('Invalid credentials');

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) throw new Error('Invalid credentials');

  const roleName = user.role ? user.role.name : 'EMPLOYEE';

  const token = jwt.sign(
    { id: user.id, email: user.email, role: roleName },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' } // Short lived access token
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' } // Long lived refresh token
  );

  return { token, refreshToken, user: { id: user.id, email: user.email, role: roleName } };
};

export const googleLogin = async (idToken: string) => {
  const ticket = await client.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error('Invalid Google token');
  }

  const email = payload.email;
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  
  if (!user) {
    throw new Error('Account not found. Please contact the administrator to create an account.');
  }

  const roleName = user.role ? user.role.name : 'EMPLOYEE';

  const token = jwt.sign(
    { id: user.id, email: user.email, role: roleName },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' }
  );

  return { token, refreshToken, user: { id: user.id, email: user.email, role: roleName } };
};

export const requestLoginOtp = async (email: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("Account not found");

  const otp = crypto.randomInt(100000, 999999).toString();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await (prisma as any).oTP.deleteMany({ where: { userId: user.id } });

  await (prisma as any).oTP.create({
    data: {
      userId: user.id,
      otpHash,
      expiresAt,
    }
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #0f172a; text-align: center;">Login via OTP</h2>
      <p style="color: #334155; font-size: 16px;">Hello ${user.firstName},</p>
      <p style="color: #334155; font-size: 16px;">Use the OTP below to securely log into your account. This OTP is valid for 5 minutes.</p>
      <div style="text-align: center; margin: 30px 0;">
        <span style="display: inline-block; padding: 15px 30px; font-size: 24px; font-weight: bold; background-color: #f1f5f9; color: #0f172a; border-radius: 6px; letter-spacing: 4px;">
          ${otp}
        </span>
      </div>
      <p style="color: #64748b; font-size: 14px; text-align: center;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;

  await sendEmail(email, "Your Login OTP - Enterprise HRMS", html);
  return true;
};

export const verifyLoginOtp = async (email: string, otp: string) => {
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user) throw new Error("Account not found");

  const latestOtp = await (prisma as any).oTP.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' }
  });

  if (!latestOtp) throw new Error("Invalid OTP");
  if (latestOtp.expiresAt < new Date()) throw new Error("OTP has expired");
  
  const isValid = await bcrypt.compare(otp, latestOtp.otpHash);
  if (!isValid) throw new Error("Invalid OTP");

  await (prisma as any).oTP.delete({ where: { id: latestOtp.id } });

  const roleName = user.role ? user.role.name : 'EMPLOYEE';

  const token = jwt.sign(
    { id: user.id, email: user.email, role: roleName },
    process.env.JWT_SECRET as string,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' }
  );

  return { token, refreshToken, user: { id: user.id, email: user.email, role: roleName } };
};

export const requestPasswordReset = async (email: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return true; // Fail silently for security

  // Generate 6-digit OTP
  const otp = crypto.randomInt(100000, 999999).toString();
  const otpHash = await bcrypt.hash(otp, 10);
  
  // Expiry in 10 minutes
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  // Invalidate old OTPs for this user
  await (prisma as any).oTP.deleteMany({ where: { userId: user.id } });

  // Store new OTP
  await (prisma as any).oTP.create({
    data: {
      userId: user.id,
      otpHash,
      expiresAt,
    }
  });

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #0f172a; text-align: center;">Password Reset Request</h2>
      <p style="color: #334155; font-size: 16px;">Hello ${user.firstName},</p>
      <p style="color: #334155; font-size: 16px;">You requested a password reset. Use the OTP below to verify your identity. This OTP is valid for 10 minutes.</p>
      <div style="text-align: center; margin: 30px 0;">
        <span style="display: inline-block; padding: 15px 30px; font-size: 24px; font-weight: bold; background-color: #f1f5f9; color: #0f172a; border-radius: 6px; letter-spacing: 4px;">
          ${otp}
        </span>
      </div>
      <p style="color: #64748b; font-size: 14px; text-align: center;">If you didn't request this, you can safely ignore this email.</p>
    </div>
  `;

  await sendEmail(email, "Password Reset OTP - Enterprise HRMS", html);
  return true;
};

export const verifyOTP = async (email: string, otp: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("Invalid OTP");

  const latestOtp = await (prisma as any).oTP.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' }
  });

  if (!latestOtp) throw new Error("Invalid OTP");
  if (latestOtp.expiresAt < new Date()) throw new Error("OTP has expired");
  
  const isValid = await bcrypt.compare(otp, latestOtp.otpHash);
  if (!isValid) throw new Error("Invalid OTP");

  // Mark as verified
  await (prisma as any).oTP.update({
    where: { id: latestOtp.id },
    data: { verified: true }
  });

  return true;
};

export const resetPassword = async (email: string, password: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("User not found");

  const latestOtp = await (prisma as any).oTP.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' }
  });

  if (!latestOtp || !latestOtp.verified) throw new Error("Please verify OTP first");

  const passwordHash = await bcrypt.hash(password, 10);
  
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash }
  });

  // Delete used OTP
  await (prisma as any).oTP.delete({ where: { id: latestOtp.id } });

  return true;
};

export const register = async (data: any) => {
  const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
  if (existingUser) throw new Error('Email already registered');

  const passwordHash = await bcrypt.hash(data.password, 10);

  let employeeRole = await prisma.role.findUnique({ where: { name: 'EMPLOYEE' } });
  if (!employeeRole) {
    employeeRole = await prisma.role.create({ data: { name: 'EMPLOYEE', description: 'Default employee role' } });
  }

  const user = await prisma.user.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      passwordHash,
      roleId: employeeRole.id
    }
  });

  return { id: user.id, email: user.email, role: 'EMPLOYEE' };
};
