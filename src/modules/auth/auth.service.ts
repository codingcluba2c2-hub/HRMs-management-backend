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
    { expiresIn: '7d' } // Short lived access token
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
    { expiresIn: '7d' }
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' }
  );

  return { token, refreshToken, user: { id: user.id, email: user.email, role: roleName } };
};

// Generates a random 6-digit OTP, saves it securely, and emails it to the user
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
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <div style="background-color: #2563eb; padding: 24px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 1px;">Enterprise HRMS</h1>
      </div>
      <div style="padding: 40px 32px; background-color: #ffffff;">
        <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 24px;">Login Verification</h2>
        <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">Hello <strong>${user.firstName}</strong>,</p>
        <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 32px;">Please use the verification code below to securely log into your account. This code is valid for the next 1 minutes.</p>
        
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-block; padding: 16px 32px; font-size: 32px; font-weight: 800; background-color: #f8fafc; color: #2563eb; border: 2px dashed #cbd5e1; border-radius: 8px; letter-spacing: 8px;">
            ${otp}
          </div>
        </div>
        
        <p style="color: #64748b; font-size: 14px; line-height: 1.5; margin-bottom: 0;">If you didn't request this login code, please ignore this email or contact your system administrator.</p>
      </div>
      <div style="background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">&copy; ${new Date().getFullYear()} Enterprise HRMS. All rights reserved.</p>
      </div>
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

  if (!latestOtp) throw new Error("Invalid OTP.");
  if (latestOtp.expiresAt < new Date()) throw new Error("OTP has expired");
  
  const isValid = await bcrypt.compare(otp, latestOtp.otpHash);
  if (!isValid) throw new Error("Invalid OTP.");

  await (prisma as any).oTP.delete({ where: { id: latestOtp.id } });

  const roleName = user.role ? user.role.name : 'EMPLOYEE';

  const token = jwt.sign(
    { id: user.id, email: user.email, role: roleName },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' }
  );

  const refreshToken = jwt.sign(
    { id: user.id },
    process.env.JWT_SECRET as string,
    { expiresIn: '7d' }
  );

  return { token, refreshToken, user: { id: user.id, email: user.email, role: roleName } };
};

// Initiates the "Forgot Password" workflow by sending a secure reset link to the user
export const requestPasswordReset = async (email: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("Account not found");

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
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <div style="background-color: #2563eb; padding: 24px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700; letter-spacing: 1px;">Enterprise HRMS</h1>
      </div>
      <div style="padding: 40px 32px; background-color: #ffffff;">
        <h2 style="color: #0f172a; font-size: 20px; font-weight: 600; margin-top: 0; margin-bottom: 24px;">Password Reset Request</h2>
        <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">Hello <strong>${user.firstName}</strong>,</p>
        <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 32px;">You recently requested to reset your password. Please use the verification code below to proceed. This code is valid for the next 10 minutes.</p>
        
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-block; padding: 16px 32px; font-size: 32px; font-weight: 800; background-color: #f8fafc; color: #2563eb; border: 2px dashed #cbd5e1; border-radius: 8px; letter-spacing: 8px;">
            ${otp}
          </div>
        </div>
        
        <p style="color: #64748b; font-size: 14px; line-height: 1.5; margin-bottom: 0;">If you didn't request a password reset, please ignore this email or contact your system administrator.</p>
      </div>
      <div style="background-color: #f8fafc; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">&copy; ${new Date().getFullYear()} Enterprise HRMS. All rights reserved.</p>
      </div>
    </div>
  `;

  await sendEmail(email, "Password Reset OTP - Enterprise HRMS", html);
  return true;
};

export const verifyOTP = async (email: string, otp: string) => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("Invalid OTP.");

  const latestOtp = await (prisma as any).oTP.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' }
  });

  if (!latestOtp) throw new Error("Invalid OTP.");
  if (latestOtp.expiresAt < new Date()) throw new Error("OTP has expired");
  
  const isValid = await bcrypt.compare(otp, latestOtp.otpHash);
  if (!isValid) throw new Error("Invalid OTP.");

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
