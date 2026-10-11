import { prisma } from '../../lib/prisma';
import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { ApiResponse } from '../../utils/ApiResponse';
import ImageKit from 'imagekit';
import { getTenantJobRoleFilter } from '../../utils/tenantFilter';
import { validateResumeBuffer, saveResumeLocally } from '../../utils/fileSecurity';

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || '',
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || '',
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || ''
});

// Helper to generate a clean URL-friendly slug
function generateSlug(title: string): string {
  const cleanTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `${cleanTitle}-${randomSuffix}`;
}

// ==========================================
// CANDIDATES MANAGEMENT (HR PROTECTED)
// ==========================================

export const getAllCandidates = async (req: Request, res: Response) => {
  try {
    const tenantJobRoleFilter = await getTenantJobRoleFilter((req as any).user);
    const candidates = await prisma.candidate.findMany({
      where: {
        jobRole: tenantJobRoleFilter
      },
      include: {
        jobRole: {
          include: {
            department: { select: { id: true, name: true } }
          }
        },
        applications: {
          include: {
            jobRole: { select: { id: true, title: true, slug: true } },
            statusHistory: {
              orderBy: { createdAt: 'desc' },
              take: 5
            }
          },
          orderBy: { appliedAt: 'desc' }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.status(200).json(new ApiResponse(true, "Success", candidates));
  } catch (error: any) {
    console.error("getAllCandidates error:", error);
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createCandidate = async (req: Request, res: Response) => {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      jobRoleId,
      currentLocation,
      experienceYears,
      currentCompany,
      currentCtc,
      expectedCtc,
      noticePeriod,
      skills,
      source
    } = req.body;

    let { resumeLink } = req.body;
    const user = (req as any).user;
    const normalizedEmail = email.trim().toLowerCase();

    // Check if candidate exists
    const existing = await prisma.candidate.findUnique({
      where: { email: normalizedEmail }
    });

    if (existing) {
      // Check if already applied to this specific role
      const existingApp = await prisma.jobApplication.findUnique({
        where: {
          candidateId_jobRoleId: {
            candidateId: existing.id,
            jobRoleId
          }
        }
      });
      if (existingApp) {
        return res.status(400).json(new ApiResponse(false, "Candidate has already applied for this job opening."));
      }
    }

    // Handle resume file upload if provided
    let resumeFileName = '';
    let resumeMimeType = '';
    let resumeSize = 0;

    if (req.file) {
      const file = req.file;
      const validation = validateResumeBuffer(file.buffer, file.originalname);
      if (!validation.isValid) {
        return res.status(400).json(new ApiResponse(false, validation.error || "Invalid resume file."));
      }

      resumeFileName = file.originalname;
      resumeMimeType = validation.detectedMime || file.mimetype;
      resumeSize = file.size;

      try {
        if (process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY) {
          const uploadResponse = await imagekit.upload({
            file: file.buffer,
            fileName: validation.safeFileName!,
            folder: '/hrms_resumes',
            useUniqueFileName: true
          });
          resumeLink = uploadResponse.url;
        } else {
          resumeLink = await saveResumeLocally(file.buffer, validation.safeFileName!);
        }
      } catch (uploadErr) {
        resumeLink = await saveResumeLocally(file.buffer, validation.safeFileName!);
      }
    }

    const job = await prisma.jobRole.findUnique({ where: { id: jobRoleId } });
    if (!job) {
      return res.status(404).json(new ApiResponse(false, "Job role not found."));
    }

    const applicationNumber = `APP-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

    const candidate = await prisma.$transaction(async (tx) => {
      const cand = await tx.candidate.upsert({
        where: { email: normalizedEmail },
        update: {
          firstName,
          lastName,
          phone: phone || null,
          jobRoleId,
          resumeLink: resumeLink || undefined,
          currentLocation: currentLocation || null,
          experienceYears: experienceYears ? parseFloat(experienceYears) : null,
          currentCompany: currentCompany || null,
          currentCtc: currentCtc || null,
          expectedCtc: expectedCtc || null,
          noticePeriod: noticePeriod || null,
          skills: skills || null,
          source: source || "MANUAL",
          companyId: user.companyId || job.companyId || null,
          createdById: user.id
        },
        create: {
          firstName,
          lastName,
          email: normalizedEmail,
          phone: phone || null,
          jobRoleId,
          resumeLink,
          interviewStatus: "PENDING",
          status: "IN_PROGRESS",
          currentLocation: currentLocation || null,
          experienceYears: experienceYears ? parseFloat(experienceYears) : null,
          currentCompany: currentCompany || null,
          currentCtc: currentCtc || null,
          expectedCtc: expectedCtc || null,
          noticePeriod: noticePeriod || null,
          skills: skills || null,
          source: source || "MANUAL",
          companyId: user.companyId || job.companyId || null,
          createdById: user.id
        }
      });

      const app = await tx.jobApplication.create({
        data: {
          applicationNumber,
          candidateId: cand.id,
          jobRoleId,
          companyId: user.companyId || job.companyId || null,
          source: source || "MANUAL",
          status: "APPLIED",
          resumeUrl: resumeLink || null,
          resumeFileName: resumeFileName || null,
          resumeMimeType: resumeMimeType || null,
          resumeSize: resumeSize || null
        }
      });

      await tx.applicationStatusHistory.create({
        data: {
          applicationId: app.id,
          previousStatus: null,
          newStatus: "APPLIED",
          actorId: user.id,
          actorName: `${user.firstName} ${user.lastName} (HR)`,
          reason: "Candidate created manually by HR"
        }
      });

      return cand;
    });

    const fullCandidate = await prisma.candidate.findUnique({
      where: { id: candidate.id },
      include: {
        jobRole: true,
        applications: {
          include: { jobRole: true, statusHistory: true }
        }
      }
    });

    return res.status(201).json(new ApiResponse(true, "Candidate registered successfully", fullCandidate));
  } catch (error: any) {
    console.error("createCandidate error:", error);
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateCandidate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { interviewStatus, status, jobRoleId, screeningNotes, reason } = req.body;
    const user = (req as any).user;

    const existingCandidate = await prisma.candidate.findUnique({
      where: { id },
      include: {
        applications: {
          orderBy: { appliedAt: 'desc' },
          take: 1
        }
      }
    });

    if (!existingCandidate) {
      return res.status(404).json(new ApiResponse(false, "Candidate not found."));
    }

    const previousStatus = existingCandidate.status;
    const newStatus = status || existingCandidate.status;

    const candidate = await prisma.$transaction(async (tx) => {
      const updatedCand = await tx.candidate.update({
        where: { id },
        data: {
          ...(interviewStatus && { interviewStatus }),
          ...(status && { status }),
          ...(jobRoleId && { jobRoleId }),
        },
        include: { jobRole: true }
      });

      // Update primary/latest JobApplication if exists
      if (existingCandidate.applications.length > 0) {
        const primaryApp = existingCandidate.applications[0];
        await tx.jobApplication.update({
          where: { id: primaryApp.id },
          data: {
            ...(status && { status }),
            ...(screeningNotes && { screeningNotes })
          }
        });

        // Record status change in immutable audit trail if status was changed
        if (status && status !== previousStatus) {
          await tx.applicationStatusHistory.create({
            data: {
              applicationId: primaryApp.id,
              previousStatus,
              newStatus,
              actorId: user?.id || null,
              actorName: user ? `${user.firstName} ${user.lastName}` : "HR User",
              reason: reason || screeningNotes || `Status updated from ${previousStatus} to ${newStatus}`
            }
          });
        }
      }

      return updatedCand;
    });

    const fullCandidate = await prisma.candidate.findUnique({
      where: { id: candidate.id },
      include: {
        jobRole: true,
        applications: {
          include: { jobRole: true, statusHistory: true }
        }
      }
    });

    return res.status(200).json(new ApiResponse(true, "Candidate updated successfully", fullCandidate));
  } catch (error: any) {
    console.error("updateCandidate error:", error);
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const deleteCandidate = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.candidate.delete({ where: { id } });
    return res.status(200).json(new ApiResponse(true, "Candidate deleted successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

/**
 * Secure resume download/preview endpoint with tenant authorization
 */
export const downloadCandidateResume = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const candidate = await prisma.candidate.findUnique({
      where: { id },
      include: { jobRole: true }
    });

    if (!candidate || !candidate.resumeLink) {
      return res.status(404).json(new ApiResponse(false, "Resume not found for this candidate."));
    }

    const resumeLink = candidate.resumeLink;

    // If local file path
    if (resumeLink.startsWith('/uploads/resumes/')) {
      const fileName = path.basename(resumeLink);
      const filePath = path.join(process.cwd(), 'uploads', 'resumes', fileName);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json(new ApiResponse(false, "Resume file is not available on storage."));
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = ext === '.pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${candidate.firstName}_${candidate.lastName}_Resume${ext}"`);
      return res.sendFile(filePath);
    }

    // Remote link (ImageKit / Cloudinary) -> Redirect to authorized URL
    return res.redirect(resumeLink);
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, "Unable to load resume."));
  }
};

// ==========================================
// JOB OPENINGS & ROLES (HR PROTECTED)
// ==========================================

export const getAllJobRoles = async (req: Request, res: Response) => {
  try {
    const tenantJobRoleFilter = await getTenantJobRoleFilter((req as any).user);
    const roles = await prisma.jobRole.findMany({
      where: tenantJobRoleFilter,
      include: {
        department: {
          select: { id: true, name: true }
        },
        _count: {
          select: {
            candidates: true,
            applications: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    return res.status(200).json(new ApiResponse(true, "Success", roles));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const createJobRole = async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      departmentId,
      responsibilities,
      qualifications,
      skills,
      minExperience,
      maxExperience,
      workLocation,
      workMode = 'ONSITE',
      employmentType = 'FULL_TIME',
      minSalary,
      maxSalary,
      currency = 'INR',
      showSalary = true,
      openings = 1,
      benefits,
      deadline,
      status = 'PUBLISHED'
    } = req.body;

    const user = (req as any).user;
    const userId = user?.id;

    if (!title || !title.trim()) {
      return res.status(400).json(new ApiResponse(false, "Job role title is required."));
    }

    const formattedTitle = title.trim();
    const slug = generateSlug(formattedTitle);

    const role = await prisma.jobRole.create({
      data: {
        title: formattedTitle,
        slug,
        description: description?.trim() || null,
        departmentId: departmentId || null,
        responsibilities: responsibilities?.trim() || null,
        qualifications: qualifications?.trim() || null,
        skills: skills?.trim() || null,
        minExperience: minExperience ? parseInt(minExperience, 10) : 0,
        maxExperience: maxExperience ? parseInt(maxExperience, 10) : null,
        workLocation: workLocation?.trim() || 'Headquarters',
        workMode: (workMode || 'ONSITE').toUpperCase(),
        employmentType: (employmentType || 'FULL_TIME').toUpperCase(),
        minSalary: minSalary ? parseFloat(minSalary) : null,
        maxSalary: maxSalary ? parseFloat(maxSalary) : null,
        currency: currency || 'INR',
        showSalary: showSalary === true || showSalary === 'true',
        openings: openings ? parseInt(openings, 10) : 1,
        benefits: benefits?.trim() || null,
        deadline: deadline ? new Date(deadline) : null,
        status: (status || 'PUBLISHED').toUpperCase(),
        publishedAt: status === 'PUBLISHED' ? new Date() : null,
        companyId: user?.companyId || null,
        createdById: userId || null
      },
      include: {
        department: true
      }
    });

    return res.status(201).json(new ApiResponse(true, "Job opening created successfully", role));
  } catch (error: any) {
    console.error("createJobRole error:", error);
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const updateJobRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      departmentId,
      responsibilities,
      qualifications,
      skills,
      minExperience,
      maxExperience,
      workLocation,
      workMode,
      employmentType,
      minSalary,
      maxSalary,
      currency,
      showSalary,
      openings,
      benefits,
      deadline,
      status
    } = req.body;

    const existing = await prisma.jobRole.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json(new ApiResponse(false, "Job role not found."));
    }

    const newStatus = status ? status.toUpperCase() : existing.status;
    const shouldSetPublishedAt = newStatus === 'PUBLISHED' && !existing.publishedAt;

    const updatedRole = await prisma.jobRole.update({
      where: { id },
      data: {
        ...(title && { title: title.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(departmentId !== undefined && { departmentId: departmentId || null }),
        ...(responsibilities !== undefined && { responsibilities: responsibilities?.trim() || null }),
        ...(qualifications !== undefined && { qualifications: qualifications?.trim() || null }),
        ...(skills !== undefined && { skills: skills?.trim() || null }),
        ...(minExperience !== undefined && { minExperience: minExperience ? parseInt(minExperience, 10) : 0 }),
        ...(maxExperience !== undefined && { maxExperience: maxExperience ? parseInt(maxExperience, 10) : null }),
        ...(workLocation !== undefined && { workLocation: workLocation?.trim() || null }),
        ...(workMode && { workMode: workMode.toUpperCase() }),
        ...(employmentType && { employmentType: employmentType.toUpperCase() }),
        ...(minSalary !== undefined && { minSalary: minSalary ? parseFloat(minSalary) : null }),
        ...(maxSalary !== undefined && { maxSalary: maxSalary ? parseFloat(maxSalary) : null }),
        ...(currency && { currency }),
        ...(showSalary !== undefined && { showSalary: showSalary === true || showSalary === 'true' }),
        ...(openings !== undefined && { openings: openings ? parseInt(openings, 10) : 1 }),
        ...(benefits !== undefined && { benefits: benefits?.trim() || null }),
        ...(deadline !== undefined && { deadline: deadline ? new Date(deadline) : null }),
        ...(status && { status: newStatus }),
        ...(shouldSetPublishedAt && { publishedAt: new Date() })
      },
      include: {
        department: true,
        _count: {
          select: { candidates: true, applications: true }
        }
      }
    });

    return res.status(200).json(new ApiResponse(true, "Job opening updated successfully", updatedRole));
  } catch (error: any) {
    console.error("updateJobRole error:", error);
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};

export const deleteJobRole = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const applicantCount = await prisma.candidate.count({ where: { jobRoleId: id } });
    if (applicantCount > 0) {
      // Instead of hard deleting, close the opening to preserve applicant audit trail
      await prisma.jobRole.update({
        where: { id },
        data: { status: 'CLOSED' }
      });
      return res.status(200).json(
        new ApiResponse(
          true,
          "Job role has active candidate applications. It has been closed to prevent new applications while preserving applicant history."
        )
      );
    }

    await prisma.jobRole.delete({ where: { id } });
    return res.status(200).json(new ApiResponse(true, "Job role deleted successfully"));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, error.message));
  }
};
