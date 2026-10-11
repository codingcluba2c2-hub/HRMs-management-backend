import { prisma } from '../lib/prisma';

async function seedInitialJobs() {
  try {
    const existingCount = await prisma.jobRole.count();
    console.log(`Current Job Roles count: ${existingCount}`);

    let company = await prisma.company.findFirst();
    if (!company) {
      company = await prisma.company.create({
        data: {
          name: 'Acme Technologies Global',
          code: 'ACME',
          website: 'https://acme.tech',
          address: 'Tech Innovation Park, Sector 62, Noida, India',
          phone: '+91 120 4567890',
          status: 'ACTIVE'
        }
      });
      console.log('✅ Created default company: Acme Technologies Global');
    }

    let engineeringDept = await prisma.department.findFirst({
      where: { name: { contains: 'Engineering', mode: 'insensitive' } }
    });
    if (!engineeringDept) {
      engineeringDept = await prisma.department.create({
        data: {
          name: 'Engineering & Technology',
          code: 'ENG',
          companyId: company.id,
          status: true
        }
      });
    }

    let hrDept = await prisma.department.findFirst({
      where: { name: { contains: 'Human Resources', mode: 'insensitive' } }
    });
    if (!hrDept) {
      hrDept = await prisma.department.create({
        data: {
          name: 'Human Resources & Talent',
          code: 'HR',
          companyId: company.id,
          status: true
        }
      });
    }

    let productDept = await prisma.department.findFirst({
      where: { name: { contains: 'Product', mode: 'insensitive' } }
    });
    if (!productDept) {
      productDept = await prisma.department.create({
        data: {
          name: 'Product & Design',
          code: 'PROD',
          companyId: company.id,
          status: true
        }
      });
    }

    const sampleJobs = [
      {
        title: 'Senior Full-Stack Engineer',
        slug: 'senior-fullstack-engineer',
        departmentId: engineeringDept.id,
        companyId: company.id,
        description: 'We are seeking an experienced Senior Full-Stack Engineer to lead the architecture, design, and implementation of high-throughput web applications and microservices.',
        responsibilities: `• Architect, develop, and maintain robust web services and intuitive client applications.\n• Collaborate closely with product managers, UI/UX designers, and platform engineers.\n• Optimize database queries, caching layers, and CI/CD deployment pipelines.\n• Advocate for software engineering best practices, security standards, and comprehensive automated testing.`,
        qualifications: `• 4+ years of professional full-stack development experience.\n• Strong proficiency in TypeScript, React / Next.js, Node.js, and PostgreSQL.\n• Experience with state management, REST/GraphQL APIs, and Docker containerization.\n• Bachelor's or Master's degree in Computer Science, Software Engineering, or equivalent practical experience.`,
        skills: 'TypeScript, React, Next.js, Node.js, PostgreSQL, Docker, Redis',
        minExperience: 4,
        maxExperience: 8,
        workLocation: 'Noida / Hybrid (Delhi-NCR)',
        workMode: 'HYBRID',
        employmentType: 'FULL_TIME',
        minSalary: 1800000,
        maxSalary: 2800000,
        currency: 'INR',
        showSalary: true,
        openings: 3,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        deadline: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000), // 45 days from now
        benefits: `• Premium medical insurance for employee, spouse, and dependents\n• Annual ₹1,00,000 learning & certification allowance\n• Ergonomic home-office workstation budget\n• Flexible work hours and hybrid work-from-home policy\n• Performance-linked bonuses and equity share options`
      },
      {
        title: 'Lead DevOps & Cloud Infrastructure Architect',
        slug: 'lead-devops-cloud-architect',
        departmentId: engineeringDept.id,
        companyId: company.id,
        description: 'Join our infrastructure team to drive cloud reliability, automated Kubernetes deployments, zero-downtime releases, and enterprise security posture.',
        responsibilities: `• Design, configure, and maintain scalable cloud infrastructure across AWS.\n• Build resilient CI/CD deployment pipelines with GitHub Actions.\n• Implement proactive observability, metrics, alerts, and log aggregation.\n• Conduct infrastructure security audits, SOC2 compliance, and disaster recovery drills.`,
        qualifications: `• 5+ years of hands-on experience in DevOps, SRE, or Cloud Architecture.\n• In-depth mastery of Kubernetes, Terraform, Docker, and AWS services.\n• Experience in managing PostgreSQL databases, Redis clusters, and message queues.`,
        skills: 'AWS, Kubernetes, Terraform, Docker, GitHub Actions, Linux, PostgreSQL',
        minExperience: 5,
        maxExperience: 10,
        workLocation: 'Bengaluru / Remote',
        workMode: 'REMOTE',
        employmentType: 'FULL_TIME',
        minSalary: 2200000,
        maxSalary: 3500000,
        currency: 'INR',
        showSalary: true,
        openings: 2,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        benefits: `• 100% Remote flexibility with home office stipend\n• Comprehensive health, dental, and vision insurance\n• Annual technology refresh allowance\n• Paid parental leave and wellness programs`
      },
      {
        title: 'Product Marketing Manager',
        slug: 'product-marketing-manager',
        departmentId: productDept.id,
        companyId: company.id,
        description: 'Drive go-to-market strategies, customer positioning, feature launches, and competitive research for our flagship enterprise SaaS products.',
        responsibilities: `• Define product messaging, value propositions, and buyer personas.\n• Partner with Sales and Customer Success teams to create collateral, case studies, and battlecards.\n• Analyze market trends, competitor insights, and customer feedback to guide product roadmap.\n• Plan and orchestrate high-impact multi-channel launch campaigns.`,
        qualifications: `• 3+ years of B2B SaaS product marketing or product management experience.\n• Exceptional written storytelling, analytical, and presentation skills.\n• Proven track record of launching successful SaaS products in international markets.`,
        skills: 'GTM Strategy, Product Positioning, B2B SaaS, Analytics, Content Strategy',
        minExperience: 3,
        maxExperience: 6,
        workLocation: 'Gurugram / Onsite',
        workMode: 'ONSITE',
        employmentType: 'FULL_TIME',
        minSalary: 1400000,
        maxSalary: 2200000,
        currency: 'INR',
        showSalary: true,
        openings: 1,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        deadline: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
        benefits: `• Competitive CTC with quarterly performance incentives\n• Daily catered gourmet lunch and on-premise gym access\n• Comprehensive group health insurance\n• Fast-track career growth opportunities`
      },
      {
        title: 'Talent Acquisition & HR Specialist',
        slug: 'talent-acquisition-hr-specialist',
        departmentId: hrDept.id,
        companyId: company.id,
        description: 'Help us scale our exceptional global team by driving full-cycle technical recruiting, candidate engagement, employer branding, and onboarding excellence.',
        responsibilities: `• Manage full-cycle recruiting from sourcing to offer negotiation and onboarding.\n• Collaborate with hiring managers to define role requirements and scorecards.\n• Drive an inclusive, transparent, and memorable candidate experience.\n• Organize campus hiring, hackathons, and employer branding campaigns.`,
        qualifications: `• 2+ years of technical sourcing and recruitment experience.\n• Familiarity with ATS workflows, LinkedIn Recruiter, and talent assessment tools.\n• High emotional intelligence, active listening, and strong communication skills.`,
        skills: 'Technical Sourcing, ATS, Candidate Experience, Interviewing, Offer Negotiation',
        minExperience: 2,
        maxExperience: 5,
        workLocation: 'Noida / Hybrid',
        workMode: 'HYBRID',
        employmentType: 'FULL_TIME',
        minSalary: 700000,
        maxSalary: 1200000,
        currency: 'INR',
        showSalary: true,
        openings: 2,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        benefits: `• Health Insurance coverage\n• Flexible leave policy and paid holidays\n• Annual bonus program\n• Friendly and supportive collaborative work culture`
      }
    ];

    for (const job of sampleJobs) {
      const existing = await prisma.jobRole.findFirst({
        where: { slug: job.slug }
      });
      if (!existing) {
        await prisma.jobRole.create({ data: job });
        console.log(`✅ Created Job Opening: "${job.title}" (slug: ${job.slug})`);
      } else {
        console.log(`ℹ️ Job already exists: "${job.title}"`);
      }
    }
  } catch (e) {
    console.error('Seed error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

seedInitialJobs();
