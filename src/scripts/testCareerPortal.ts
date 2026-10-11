import axios from 'axios';
import { prisma } from '../lib/prisma';

const API_BASE = 'http://localhost:6002/api';

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING ENTERPRISE CAREER PORTAL INTEGRATION TESTS');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      console.log(`✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${testName} - ${details || ''}`);
      failed++;
    }
  }

  try {
    // 1. Public careers endpoint accessible without authentication
    const jobsRes = await axios.get(`${API_BASE}/careers/jobs`);
    assert(
      jobsRes.status === 200 && jobsRes.data?.success === true,
      'Test 1: Public careers page loads without authentication'
    );

    const jobs = jobsRes.data?.data?.jobs || [];
    assert(jobs.length > 0, 'Test 2: Published jobs are publicly listed', `Found ${jobs.length} jobs`);

    // 2. Verify public API does not expose internal private fields
    const firstJob = jobs[0];
    const hasNoInternalNotes = (firstJob as any).internalNotes === undefined;
    const hasNoRecruiterId = (firstJob as any).createdById === undefined;
    const hasNoApplicantsList = (firstJob as any).candidates === undefined && (firstJob as any).applications === undefined;
    assert(
      hasNoInternalNotes && hasNoRecruiterId && hasNoApplicantsList,
      'Test 3: Public API does not reveal internal notes, recruiter IDs, or candidate records'
    );

    // 3. Draft & Closed jobs filtering
    const testDraftJob = await prisma.jobRole.create({
      data: {
        title: 'Draft Security Architect',
        slug: 'draft-security-architect-test',
        status: 'DRAFT',
        workLocation: 'Remote',
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME'
      }
    });

    const testClosedJob = await prisma.jobRole.create({
      data: {
        title: 'Closed Research Scientist',
        slug: 'closed-research-scientist-test',
        status: 'CLOSED',
        workLocation: 'Headquarters',
        workMode: 'ONSITE',
        employmentType: 'FULL_TIME'
      }
    });

    const refreshedJobsRes = await axios.get(`${API_BASE}/careers/jobs`);
    const refreshedJobs = refreshedJobsRes.data?.data?.jobs || [];
    const containsDraft = refreshedJobs.some((j: any) => j.slug === testDraftJob.slug);
    const containsClosed = refreshedJobs.some((j: any) => j.slug === testClosedJob.slug);

    assert(
      !containsDraft && !containsClosed,
      'Test 4: Draft and closed jobs are NEVER publicly listed'
    );

    // 4. Job Details by Slug
    const targetSlug = 'senior-fullstack-engineer';
    const detailRes = await axios.get(`${API_BASE}/careers/jobs/${targetSlug}`);
    assert(
      detailRes.status === 200 && detailRes.data?.data?.slug === targetSlug,
      'Test 5: Public job details retrieved with full descriptions, responsibilities, and skills'
    );

    // 5. Non-existent slug returns 404
    try {
      await axios.get(`${API_BASE}/careers/jobs/non-existent-random-role-slug-999`);
      assert(false, 'Test 6: Non-existent job slug returns 404');
    } catch (err: any) {
      assert(err.response?.status === 404, 'Test 6: Non-existent job slug correctly returns 404');
    }

    // 6. Applying to closed job returns 404 or 400
    try {
      const FormData = require('form-data');
      const form = new FormData();
      form.append('firstName', 'Test');
      form.append('lastName', 'Candidate');
      form.append('email', 'test.closed@example.com');
      form.append('phone', '+919999999999');
      form.append('privacyConsent', 'true');
      const pdfBuffer = Buffer.from('%PDF-1.4 valid test pdf content %%EOF');
      form.append('resume', pdfBuffer, { filename: 'resume.pdf', contentType: 'application/pdf' });

      await axios.post(`${API_BASE}/careers/jobs/${testClosedJob.slug}/apply`, form, {
        headers: form.getHeaders()
      });
      assert(false, 'Test 7: Applications to closed jobs are rejected');
    } catch (err: any) {
      assert(err.response?.status === 404 || err.response?.status === 400, 'Test 7: Applications to closed jobs are rejected');
    }

    // 7. Successful candidate application submission
    const candidateEmail = `test.applicant.${Date.now()}@example.com`;
    const FormData = require('form-data');
    const validForm = new FormData();
    validForm.append('firstName', 'Aarav');
    validForm.append('lastName', 'Verma');
    validForm.append('email', candidateEmail);
    validForm.append('phone', '+91 9876543210');
    validForm.append('currentLocation', 'Noida, India');
    validForm.append('highestQualification', 'B.Tech Computer Science');
    validForm.append('experienceYears', '4.5');
    validForm.append('currentCompany', 'Global Enterprise Ltd');
    validForm.append('currentCtc', '₹16,00,000');
    validForm.append('expectedCtc', '₹24,00,000');
    validForm.append('noticePeriod', '30_DAYS');
    validForm.append('skills', 'React, Node.js, TypeScript, PostgreSQL');
    validForm.append('privacyConsent', 'true');
    const validPdfBuffer = Buffer.from('%PDF-1.4 %âãÏÓ\n1 0 obj\n<< /Title (Resume) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
    validForm.append('resume', validPdfBuffer, { filename: 'Aarav_Verma_Resume.pdf', contentType: 'application/pdf' });

    const applyRes = await axios.post(`${API_BASE}/careers/jobs/${targetSlug}/apply`, validForm, {
      headers: validForm.getHeaders()
    });

    assert(
      applyRes.status === 201 && applyRes.data?.success === true && !!applyRes.data?.data?.applicationNumber,
      'Test 8: Successful public candidate application with PDF resume & application reference generated',
      `App Number: ${applyRes.data?.data?.applicationNumber}`
    );

    // 8. Reject invalid resume (invalid magic bytes)
    try {
      const invalidForm = new FormData();
      invalidForm.append('firstName', 'Fake');
      invalidForm.append('lastName', 'Resume');
      invalidForm.append('email', `fake.${Date.now()}@example.com`);
      invalidForm.append('phone', '+91 9876543210');
      invalidForm.append('privacyConsent', 'true');
      const fakeBuffer = Buffer.from('This is not a pdf file at all!');
      invalidForm.append('resume', fakeBuffer, { filename: 'fake.pdf', contentType: 'application/pdf' });

      await axios.post(`${API_BASE}/careers/jobs/${targetSlug}/apply`, invalidForm, {
        headers: invalidForm.getHeaders()
      });
      assert(false, 'Test 9: Invalid resume without PDF magic bytes is rejected');
    } catch (err: any) {
      assert(err.response?.status === 400, 'Test 9: Invalid resume without PDF magic bytes is rejected (Magic byte inspection)');
    }

    // 9. Reject missing privacy consent
    try {
      const noConsentForm = new FormData();
      noConsentForm.append('firstName', 'No');
      noConsentForm.append('lastName', 'Consent');
      noConsentForm.append('email', `noconsent.${Date.now()}@example.com`);
      noConsentForm.append('phone', '+91 9876543210');
      noConsentForm.append('privacyConsent', 'false');
      noConsentForm.append('resume', validPdfBuffer, { filename: 'resume.pdf', contentType: 'application/pdf' });

      await axios.post(`${API_BASE}/careers/jobs/${targetSlug}/apply`, noConsentForm, {
        headers: noConsentForm.getHeaders()
      });
      assert(false, 'Test 10: Submission without privacy consent is rejected');
    } catch (err: any) {
      assert(err.response?.status === 400, 'Test 10: Submission without privacy consent is rejected');
    }

    // 10. Duplicate submission protection for SAME job opening
    try {
      const dupForm = new FormData();
      dupForm.append('firstName', 'Aarav');
      dupForm.append('lastName', 'Verma');
      dupForm.append('email', candidateEmail); // SAME EMAIL
      dupForm.append('phone', '+91 9876543210');
      dupForm.append('privacyConsent', 'true');
      dupForm.append('resume', validPdfBuffer, { filename: 'resume.pdf', contentType: 'application/pdf' });

      await axios.post(`${API_BASE}/careers/jobs/${targetSlug}/apply`, dupForm, {
        headers: dupForm.getHeaders()
      });
      assert(false, 'Test 11: Duplicate application for the SAME job opening is rejected');
    } catch (err: any) {
      assert(err.response?.status === 409, 'Test 11: Duplicate application for the SAME job opening is rejected with 409 Conflict');
    }

    // 11. SAME candidate applying to a DIFFERENT job opening (Allowed!)
    const secondSlug = 'lead-devops-cloud-architect';
    const secondForm = new FormData();
    secondForm.append('firstName', 'Aarav');
    secondForm.append('lastName', 'Verma');
    secondForm.append('email', candidateEmail); // SAME EMAIL
    secondForm.append('phone', '+91 9876543210');
    secondForm.append('privacyConsent', 'true');
    secondForm.append('resume', validPdfBuffer, { filename: 'resume.pdf', contentType: 'application/pdf' });

    const secondApplyRes = await axios.post(`${API_BASE}/careers/jobs/${secondSlug}/apply`, secondForm, {
      headers: secondForm.getHeaders()
    });

    assert(
      secondApplyRes.status === 201 && secondApplyRes.data?.success === true,
      'Test 12: Candidate CAN apply to multiple different job openings without collision'
    );

    // 12. Verify Database records & Audit trail
    const savedCandidate = await prisma.candidate.findUnique({
      where: { email: candidateEmail },
      include: {
        applications: {
          include: { statusHistory: true, jobRole: true }
        }
      }
    });

    assert(
      !!savedCandidate && savedCandidate.source === 'CAREER_PORTAL' && savedCandidate.applications.length === 2,
      'Test 13: Candidate profile and 2 JobApplications stored in PostgreSQL under respective jobs'
    );

    const firstApp = savedCandidate?.applications[0];
    assert(
      !!firstApp?.statusHistory && firstApp.statusHistory.length >= 1 && firstApp.statusHistory[0].newStatus === 'APPLIED',
      'Test 14: ApplicationStatusHistory audit log record created automatically upon submission'
    );

    // 13. Clean up test records
    await prisma.jobApplication.deleteMany({
      where: { candidateId: savedCandidate!.id }
    });
    await prisma.candidate.delete({
      where: { id: savedCandidate!.id }
    });
    await prisma.jobRole.deleteMany({
      where: { id: { in: [testDraftJob.id, testClosedJob.id] } }
    });

    console.log('\n======================================================');
    console.log(`🎉 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================\n');
  } catch (err: any) {
    console.error('Fatal test error:', err.message, err.response?.data);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
