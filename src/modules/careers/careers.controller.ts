import { Request, Response } from 'express';
import { prisma } from '../../lib/prisma';
import { ApiResponse } from '../../utils/ApiResponse';
import { validateResumeBuffer, saveResumeLocally } from '../../utils/fileSecurity';
import { sendEmail } from '../../utils/mailer';
import ImageKit from 'imagekit';

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || '',
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || '',
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || ''
});

// Cache map for client idempotency keys (prevents rapid duplicate submissions)
const idempotencyCache = new Map<string, { timestamp: number; responseData: any }>();

// Cleanup stale idempotency keys every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of idempotencyCache.entries()) {
    if (now - val.timestamp > 15 * 60 * 1000) {
      idempotencyCache.delete(key);
    }
  }
}, 10 * 60 * 1000);

/**
 * Public: List all published job openings with filtering and pagination
 */
export const getPublicJobs = async (req: Request, res: Response) => {
  try {
    const {
      search,
      departmentId,
      workMode,
      employmentType,
      location,
      page = '1',
      limit = '10'
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const where: any = {
      status: 'PUBLISHED'
    };

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { skills: { contains: q, mode: 'insensitive' } }
      ];
    }

    if (departmentId && departmentId !== 'ALL') {
      where.departmentId = departmentId;
    }

    if (workMode && workMode !== 'ALL') {
      where.workMode = (workMode as string).toUpperCase();
    }

    if (employmentType && employmentType !== 'ALL') {
      where.employmentType = (employmentType as string).toUpperCase();
    }

    if (location && typeof location === 'string' && location.trim() && location !== 'ALL') {
      where.workLocation = { contains: location.trim(), mode: 'insensitive' };
    }

    const [totalCount, jobs] = await Promise.all([
      prisma.jobRole.count({ where }),
      prisma.jobRole.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { publishedAt: 'desc' },
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          workLocation: true,
          workMode: true,
          employmentType: true,
          minExperience: true,
          maxExperience: true,
          minSalary: true,
          maxSalary: true,
          currency: true,
          showSalary: true,
          openings: true,
          skills: true,
          benefits: true,
          deadline: true,
          publishedAt: true,
          department: {
            select: {
              id: true,
              name: true
            }
          },
          company: {
            select: {
              name: true,
              website: true
            }
          }
        }
      })
    ]);

    // Mask salary if employer chose not to disclose
    const sanitizedJobs = jobs.map((job) => ({
      ...job,
      minSalary: job.showSalary ? job.minSalary : null,
      maxSalary: job.showSalary ? job.maxSalary : null
    }));

    return res.status(200).json(
      new ApiResponse(true, 'Published job openings fetched successfully', {
        jobs: sanitizedJobs,
        pagination: {
          total: totalCount,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(totalCount / limitNum) || 1
        }
      })
    );
  } catch (error: any) {
    console.error('getPublicJobs error:', error);
    return res.status(500).json(new ApiResponse(false, 'Unable to load careers at this time.'));
  }
};

/**
 * Public: Get single published job opening by slug
 */
export const getPublicJobBySlug = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    if (!slug) {
      return res.status(400).json(new ApiResponse(false, 'Job slug is required.'));
    }

    const job = await prisma.jobRole.findFirst({
      where: {
        slug,
        status: 'PUBLISHED'
      },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        responsibilities: true,
        qualifications: true,
        skills: true,
        workLocation: true,
        workMode: true,
        employmentType: true,
        minExperience: true,
        maxExperience: true,
        minSalary: true,
        maxSalary: true,
        currency: true,
        showSalary: true,
        openings: true,
        benefits: true,
        deadline: true,
        publishedAt: true,
        department: {
          select: {
            id: true,
            name: true
          }
        },
        company: {
          select: {
            name: true,
            website: true,
            address: true
          }
        }
      }
    });

    if (!job) {
      return res.status(404).json(new ApiResponse(false, 'Job opening not found or is no longer accepting applications.'));
    }

    // Mask salary if showSalary is false
    const sanitizedJob = {
      ...job,
      minSalary: job.showSalary ? job.minSalary : null,
      maxSalary: job.showSalary ? job.maxSalary : null,
      isExpired: job.deadline ? new Date(job.deadline) < new Date() : false
    };

    return res.status(200).json(new ApiResponse(true, 'Job details retrieved successfully', sanitizedJob));
  } catch (error: any) {
    console.error('getPublicJobBySlug error:', error);
    return res.status(500).json(new ApiResponse(false, 'Unable to load job details.'));
  }
};

/**
 * Public: List active departments with published positions
 */
export const getPublicDepartments = async (req: Request, res: Response) => {
  try {
    const departments = await prisma.department.findMany({
      where: {
        jobRoles: {
          some: { status: 'PUBLISHED' }
        }
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            jobRoles: {
              where: { status: 'PUBLISHED' }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    return res.status(200).json(new ApiResponse(true, 'Active departments retrieved', departments));
  } catch (error: any) {
    return res.status(500).json(new ApiResponse(false, 'Unable to load departments.'));
  }
};

/**
 * Public: Submit candidate job application with secure resume upload
 */
export const submitPublicApplication = async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const {
      firstName,
      lastName,
      email,
      phone,
      currentLocation,
      highestQualification,
      college,
      experienceYears,
      currentCompany,
      currentCtc,
      expectedCtc,
      noticePeriod,
      skills,
      linkedInUrl,
      githubUrl,
      portfolioUrl,
      coverLetter,
      privacyConsent,
      honeypot,
      idempotencyToken
    } = req.body;

    // 1. Anti-Spam Honeypot Check (If filled, silently ignore bot)
    if (honeypot && String(honeypot).trim().length > 0) {
      console.warn('Bot submission blocked via honeypot field.');
      return res.status(200).json(
        new ApiResponse(true, 'Application received successfully', {
          applicationNumber: 'APP-BOT-DISCARDED'
        })
      );
    }

    // 2. Client Idempotency Check
    const idempotencyKey = idempotencyToken || req.headers['x-idempotency-key'];
    if (idempotencyKey && typeof idempotencyKey === 'string') {
      const cached = idempotencyCache.get(idempotencyKey);
      if (cached) {
        return res.status(200).json(cached.responseData);
      }
    }

    // 3. Required Fields Validation
    if (!firstName?.trim() || !lastName?.trim()) {
      return res.status(400).json(new ApiResponse(false, 'First name and last name are required.'));
    }

    if (!email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json(new ApiResponse(false, 'A valid email address is required.'));
    }

    if (!phone?.trim()) {
      return res.status(400).json(new ApiResponse(false, 'Phone number is required.'));
    }

    if (privacyConsent !== true && privacyConsent !== 'true') {
      return res.status(400).json(new ApiResponse(false, 'You must agree to the privacy policy to submit your application.'));
    }

    // 4. Validate Job Existence & Status
    const job = await prisma.jobRole.findFirst({
      where: {
        slug,
        status: 'PUBLISHED'
      },
      include: {
        company: true
      }
    });

    if (!job) {
      return res.status(404).json(new ApiResponse(false, 'This job opening is no longer open or does not exist.'));
    }

    if (job.deadline && new Date(job.deadline) < new Date()) {
      return res.status(400).json(new ApiResponse(false, 'The application deadline for this position has passed.'));
    }

    // 5. Resume File Validation
    const file = req.file;
    if (!file) {
      return res.status(400).json(new ApiResponse(false, 'Please upload your resume in PDF or DOCX format.'));
    }

    const validation = validateResumeBuffer(file.buffer, file.originalname);
    if (!validation.isValid) {
      return res.status(400).json(new ApiResponse(false, validation.error || 'Invalid resume file.'));
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 6. Check Duplicate Application for THIS specific job opening
    const existingCandidate = await prisma.candidate.findUnique({
      where: { email: normalizedEmail }
    });

    if (existingCandidate) {
      const existingApplication = await prisma.jobApplication.findUnique({
        where: {
          candidateId_jobRoleId: {
            candidateId: existingCandidate.id,
            jobRoleId: job.id
          }
        }
      });

      if (existingApplication) {
        return res.status(409).json(
          new ApiResponse(
            false,
            `You have already submitted an application for "${job.title}". Our team will review your profile and reach out.`
          )
        );
      }
    }

    // 7. Secure File Storage: Upload to ImageKit or Local Private Storage
    let resumeUrl = '';
    const safeFileName = validation.safeFileName!;

    try {
      if (process.env.IMAGEKIT_PUBLIC_KEY && process.env.IMAGEKIT_PRIVATE_KEY) {
        const uploadResponse = await imagekit.upload({
          file: file.buffer,
          fileName: safeFileName,
          folder: '/hrms_resumes',
          useUniqueFileName: true
        });
        resumeUrl = uploadResponse.url;
      } else {
        resumeUrl = await saveResumeLocally(file.buffer, safeFileName);
      }
    } catch (uploadError) {
      console.warn('ImageKit upload fallback to local storage:', uploadError);
      resumeUrl = await saveResumeLocally(file.buffer, safeFileName);
    }

    // 8. Generate Unique Application Number
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const applicationNumber = `APP-${new Date().getFullYear()}-${randomSuffix}`;

    // 9. Upsert Candidate Profile & Create Application in DB Transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create or update Candidate record
      const candidateData: any = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: normalizedEmail,
        phone: phone.trim(),
        currentLocation: currentLocation?.trim() || null,
        highestQualification: highestQualification?.trim() || null,
        college: college?.trim() || null,
        experienceYears: experienceYears ? parseFloat(experienceYears) : null,
        currentCompany: currentCompany?.trim() || null,
        currentCtc: currentCtc?.trim() || null,
        expectedCtc: expectedCtc?.trim() || null,
        noticePeriod: noticePeriod?.trim() || null,
        skills: skills?.trim() || null,
        linkedInUrl: linkedInUrl?.trim() || null,
        githubUrl: githubUrl?.trim() || null,
        portfolioUrl: portfolioUrl?.trim() || null,
        coverLetter: coverLetter?.trim() || null,
        source: 'CAREER_PORTAL',
        resumeLink: resumeUrl,
        jobRoleId: job.id, // Primary/latest applied role
        companyId: job.companyId,
        createdById: job.createdById
      };

      const candidate = await tx.candidate.upsert({
        where: { email: normalizedEmail },
        update: candidateData,
        create: candidateData
      });

      // Create JobApplication
      const application = await tx.jobApplication.create({
        data: {
          applicationNumber,
          candidateId: candidate.id,
          jobRoleId: job.id,
          companyId: job.companyId,
          source: 'CAREER_PORTAL',
          status: 'APPLIED',
          resumeUrl,
          resumeFileName: file.originalname,
          resumeMimeType: validation.detectedMime,
          resumeSize: file.size,
          coverLetter: coverLetter?.trim() || null
        }
      });

      // Create Initial Status History Audit Record
      await tx.applicationStatusHistory.create({
        data: {
          applicationId: application.id,
          previousStatus: null,
          newStatus: 'APPLIED',
          actorName: `${firstName.trim()} ${lastName.trim()} (Candidate)`,
          reason: 'Application submitted online via Career Portal'
        }
      });

      return { candidate, application };
    });

    // 10. Send Confirmation Email to Candidate (Non-blocking)
    const companyName = job.company?.name || 'HRMS Pro';
    const emailSubject = `Application Received: ${job.title} at ${companyName} (${applicationNumber})`;
    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background: #ffffff;">
        <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px 24px; text-align: center; color: white;">
          <h1 style="margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">Application Received</h1>
          <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.9;">${companyName} Talent Acquisition</p>
        </div>
        <div style="padding: 32px 24px; color: #1e293b; line-height: 1.6;">
          <p style="font-size: 16px; margin: 0 0 16px;">Dear <strong>${firstName} ${lastName}</strong>,</p>
          <p style="margin: 0 0 20px;">Thank you for your interest in joining <strong>${companyName}</strong>. We have successfully received your application for the role of <strong>${job.title}</strong>.</p>
          
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
            <div style="margin-bottom: 8px;"><span style="color: #64748b; font-size: 13px;">Application Reference:</span> <strong style="font-family: monospace; font-size: 14px; color: #0f172a;">${applicationNumber}</strong></div>
            <div style="margin-bottom: 8px;"><span style="color: #64748b; font-size: 13px;">Position Applied:</span> <strong style="color: #0f172a;">${job.title}</strong></div>
            <div style="margin-bottom: 8px;"><span style="color: #64748b; font-size: 13px;">Work Location:</span> <strong>${job.workLocation || 'Headquarters'}</strong> (${job.workMode})</div>
            <div><span style="color: #64748b; font-size: 13px;">Submitted On:</span> <strong>${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong></div>
          </div>

          <h3 style="font-size: 15px; font-weight: 600; margin: 0 0 12px; color: #0f172a;">What happens next?</h3>
          <ol style="margin: 0 0 24px; padding-left: 20px; font-size: 14px; color: #475569;">
            <li style="margin-bottom: 6px;">Our talent acquisition team will review your qualifications and experience.</li>
            <li style="margin-bottom: 6px;">If your profile matches our requirements, we will reach out to schedule an introductory conversation.</li>
            <li>You can keep this email and reference number handy for any future inquiries.</li>
          </ol>

          <p style="margin: 0; font-size: 14px; color: #64748b;">Best regards,<br><strong style="color: #1e293b;">The Recruitment Team</strong><br>${companyName}</p>
        </div>
        <div style="background: #f1f5f9; padding: 16px 24px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0;">
          This is an automated notification from ${companyName} Careers Portal. Please do not reply directly to this email.
        </div>
      </div>
    `;

    sendEmail(normalizedEmail, emailSubject, emailHtml).catch((err) => {
      console.warn('Confirmation email sending failed (non-critical):', err.message);
    });

    const responsePayload = new ApiResponse(true, 'Application submitted successfully!', {
      applicationNumber,
      jobTitle: job.title,
      candidateEmail: normalizedEmail,
      appliedAt: new Date().toISOString()
    });

    // Save to idempotency cache
    if (idempotencyKey && typeof idempotencyKey === 'string') {
      idempotencyCache.set(idempotencyKey, {
        timestamp: Date.now(),
        responseData: responsePayload
      });
    }

    return res.status(201).json(responsePayload);
  } catch (error: any) {
    console.error('submitPublicApplication error:', error);
    return res.status(500).json(new ApiResponse(false, 'Unable to submit application at this time. Please try again.'));
  }
};
