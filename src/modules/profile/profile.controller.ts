import { prisma } from '../../lib/prisma';
import { Response } from 'express';
import { ApiResponse } from '../../utils/ApiResponse';
import { AuthRequest } from '../../middlewares/authMiddleware';
import ImageKit from 'imagekit';
import { decrypt, encrypt } from '../../utils/encryption';

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY!,
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT!
});

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json(new ApiResponse(false, "Unauthorized"));

    let user = await prisma.user.findUnique({
      where: { email: userEmail },
      include: {
        role: true,
        employee: {
          include: {
            department: true,
            designation: true,
            manager: {
              include: {
                user: true
              }
            }
          }
        }
      }
    });

    if (!user) return res.status(404).json(new ApiResponse(false, "User not found"));

    if (!user.employee) {
      const emp = await prisma.employee.findFirst({
        where: { email: { equals: userEmail, mode: 'insensitive' } },
        include: {
          department: true,
          designation: true,
          manager: {
            include: { user: true }
          }
        }
      });

      if (emp) {
        if (!emp.userId) {
          await prisma.employee.update({
            where: { id: emp.id },
            data: { userId: user.id }
          });
        }
        (user as any).employee = emp;
      }
    }

    const { passwordHash: _, ...sanitized } = user;

    const empForCreator = (user as any).employee || await prisma.employee.findFirst({
      where: { OR: [{ userId: user.id }, { email: { equals: userEmail, mode: 'insensitive' } }] }
    });

    if (empForCreator && empForCreator.createdById) {
      const creator = await prisma.user.findUnique({ where: { id: empForCreator.createdById } });
      if (creator) {
        (sanitized as any).companyName = creator.companyName || sanitized.companyName;
        (sanitized as any).companyWebsite = creator.companyWebsite || sanitized.companyWebsite;
        (sanitized as any).companyAddress = creator.companyAddress || sanitized.companyAddress;
        (sanitized as any).companyPhone = creator.companyPhone || sanitized.companyPhone;
      }
    }

    return res.status(200).json(new ApiResponse(true, "Profile fetched", sanitized));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json(new ApiResponse(false, "Unauthorized"));

    const { firstName, lastName, phone } = req.body;
    
    // We explicitly do NOT allow updating email, role, or password here.
    const user = await prisma.user.update({
      where: { email: userEmail },
      data: { firstName, lastName, phone },
      include: { role: true }
    });

    const { passwordHash: _, ...sanitized } = user;
    return res.status(200).json(new ApiResponse(true, "Profile updated successfully", sanitized));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateProfilePicture = async (req: AuthRequest, res: Response) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json(new ApiResponse(false, "Unauthorized"));

    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) return res.status(404).json(new ApiResponse(false, "User not found"));

    if (!req.file) {
      return res.status(400).json(new ApiResponse(false, "No image file provided"));
    }

    // Upload to ImageKit
    const uploadResponse = await imagekit.upload({
      file: req.file.buffer,
      fileName: `profile_${user.id}_${Date.now()}`,
      folder: '/HRMS/Profiles'
    });

    const updatedUser = await prisma.user.update({
      where: { email: userEmail },
      data: { profilePic: uploadResponse.url },
      include: { role: true }
    });

    const { passwordHash: _, ...sanitized } = updatedUser;
    return res.status(200).json(new ApiResponse(true, "Profile picture updated successfully", sanitized));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const getFullProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json(new ApiResponse(false, "Unauthorized"));

    let user = await prisma.user.findUnique({
      where: { email: userEmail },
      include: {
        role: true,
        employee: {
          include: {
            department: true,
            designation: true,
            manager: {
              include: { user: true }
            },
            leaveBalance: true,
            documents: true
          }
        }
      }
    });

    if (!user) return res.status(404).json(new ApiResponse(false, "User not found"));

    if (!user.employee) {
      const emp = await prisma.employee.findFirst({
        where: { email: { equals: userEmail, mode: 'insensitive' } },
        include: {
          department: true,
          designation: true,
          manager: {
            include: { user: true }
          },
          leaveBalance: true,
          documents: true
        }
      });

      if (emp) {
        if (!emp.userId) {
          await prisma.employee.update({
            where: { id: emp.id },
            data: { userId: user.id }
          });
        }
        (user as any).employee = emp;
      }
    }

    const { passwordHash: _, ...sanitized } = user;

    if (sanitized.employee && sanitized.employee.accountNumber) {
      try {
        sanitized.employee.accountNumber = decrypt(sanitized.employee.accountNumber);
      } catch (e) {
        console.error("Failed to decrypt account number for user", userEmail);
      }
    }

    const empForCreatorFull = (user as any).employee || await prisma.employee.findFirst({
      where: { OR: [{ userId: user.id }, { email: { equals: userEmail, mode: 'insensitive' } }] }
    });

    if (empForCreatorFull && empForCreatorFull.createdById) {
      const creator = await prisma.user.findUnique({ where: { id: empForCreatorFull.createdById } });
      if (creator) {
        (sanitized as any).companyName = creator.companyName || sanitized.companyName;
        (sanitized as any).companyWebsite = creator.companyWebsite || sanitized.companyWebsite;
        (sanitized as any).companyAddress = creator.companyAddress || sanitized.companyAddress;
        (sanitized as any).companyPhone = creator.companyPhone || sanitized.companyPhone;
      }
    }
    
    return res.status(200).json(new ApiResponse(true, "Full profile fetched", sanitized));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updatePersonal = async (req: AuthRequest, res: Response) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json(new ApiResponse(false, "Unauthorized"));

    const data = req.body;
    
    const user = await prisma.user.update({
      where: { email: userEmail },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
      },
      include: { employee: true }
    });

    let employee = user.employee;
    if (!employee) {
      employee = await prisma.employee.findFirst({
        where: { OR: [{ userId: user.id }, { email: { equals: userEmail, mode: 'insensitive' } }] }
      });
      if (employee && !employee.userId) {
        await prisma.employee.update({ where: { id: employee.id }, data: { userId: user.id } });
      }
    }

    if (employee) {
      await prisma.employee.update({
        where: { id: employee.id },
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          gender: data.gender || null,
          dob: data.dob ? new Date(data.dob) : null,
          bloodGroup: data.bloodGroup || null,
          maritalStatus: data.maritalStatus || null,
          nationality: data.nationality || null,
        }
      });
    }

    return res.status(200).json(new ApiResponse(true, "Personal info updated successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateContact = async (req: AuthRequest, res: Response) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json(new ApiResponse(false, "Unauthorized"));

    const data = req.body;
    const user = await prisma.user.findUnique({ where: { email: userEmail }, include: { employee: true } });
    if (!user) return res.status(404).json(new ApiResponse(false, "User not found"));

    let employee = user.employee;
    if (!employee) {
      employee = await prisma.employee.findFirst({
        where: { OR: [{ userId: user.id }, { email: { equals: userEmail, mode: 'insensitive' } }] }
      });
      if (employee && !employee.userId) {
        await prisma.employee.update({ where: { id: employee.id }, data: { userId: user.id } });
      }
    }

    if (data.phone) {
      await prisma.user.update({
        where: { email: userEmail },
        data: { phone: data.phone }
      });
    }

    if (employee) {
      await prisma.employee.update({
        where: { id: employee.id },
        data: {
          phone: data.phone || null,
          alternatePhone: data.alternatePhone || null,
          emergencyEmail: data.emergencyEmail || null,
          address: data.address || null,
          city: data.city || null,
          state: data.state || null,
          country: data.country || null,
          postalCode: data.postalCode || null,
          emergencyContactName: data.emergencyContactName || null,
          emergencyContactRelation: data.emergencyContactRelation || null,
          emergencyContactPhone: data.emergencyContactPhone || null,
          emergencyContactAddress: data.emergencyContactAddress || null,
        }
      });
    }

    return res.status(200).json(new ApiResponse(true, "Contact info updated successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateBank = async (req: AuthRequest, res: Response) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json(new ApiResponse(false, "Unauthorized"));

    const data = req.body;
    const user = await prisma.user.findUnique({ where: { email: userEmail }, include: { employee: true } });
    if (!user?.employee) return res.status(404).json(new ApiResponse(false, "Employee not found"));

    await prisma.employee.update({
      where: { id: user.employee.id },
      data: {
        bankName: data.bankName,
        accountNumber: data.accountNumber ? encrypt(data.accountNumber) : undefined,
        ifsc: data.ifsc,
        upiId: data.upiId,
      }
    });

    return res.status(200).json(new ApiResponse(true, "Bank details updated successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateSkills = async (req: AuthRequest, res: Response) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json(new ApiResponse(false, "Unauthorized"));

    const data = req.body;
    const user = await prisma.user.findUnique({ where: { email: userEmail }, include: { employee: true } });
    if (!user?.employee) return res.status(404).json(new ApiResponse(false, "Employee not found"));

    await prisma.employee.update({
      where: { id: user.employee.id },
      data: {
        skills: data.skills || [],
        certifications: data.certifications || []
      }
    });

    return res.status(200).json(new ApiResponse(true, "Skills updated successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updatePreferences = async (req: AuthRequest, res: Response) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json(new ApiResponse(false, "Unauthorized"));

    const data = req.body;

    await prisma.user.update({
      where: { email: userEmail },
      data: {
        preferences: data.preferences
      }
    });

    return res.status(200).json(new ApiResponse(true, "Preferences updated successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

import bcrypt from 'bcryptjs';

export const updateSecurity = async (req: AuthRequest, res: Response) => {
  try {
    const userEmail = req.user?.email;
    if (!userEmail) return res.status(401).json(new ApiResponse(false, "Unauthorized"));

    const { currentPassword, newPassword, twoFactorEnabled } = req.body;
    
    const user = await prisma.user.findUnique({ where: { email: userEmail } });
    if (!user) return res.status(404).json(new ApiResponse(false, "User not found"));

    const updates: any = {};

    if (currentPassword && newPassword) {
      const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValid) return res.status(400).json(new ApiResponse(false, "Incorrect current password"));
      
      updates.passwordHash = await bcrypt.hash(newPassword, 10);
      updates.lastPasswordChange = new Date();
    }
    
    if (twoFactorEnabled !== undefined) {
      updates.twoFactorEnabled = twoFactorEnabled;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({
        where: { email: userEmail },
        data: updates
      });
    }

    return res.status(200).json(new ApiResponse(true, "Security settings updated successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

