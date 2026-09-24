import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { ApiResponse } from '../../utils/ApiResponse';

export const getLoginContentHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Attempt to fetch from SystemSetting, fallback to defaults if not found
    const settings = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: ['LOGIN_CAROUSEL', 'LOGIN_ANNOUNCEMENTS', 'LOGIN_STATISTICS', 'LOGIN_HERO']
        }
      }
    });

    const settingsMap = settings.reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {} as Record<string, string>);

    // Parse JSON values safely
    const parseOrDefault = (key: string, defaultValue: any) => {
      if (settingsMap[key]) {
        try {
          return JSON.parse(settingsMap[key]);
        } catch {
          return defaultValue;
        }
      }
      return defaultValue;
    };

    const heroSlides = parseOrDefault('LOGIN_HERO_SLIDES', [
      {
        id: "1",
        title: "Manage Employees",
        description: "Streamline your entire employee lifecycle from onboarding to offboarding with our comprehensive suite of HR tools and real-time analytics.",
        icon: "Users"
      },
      {
        id: "2",
        title: "Track Attendance",
        description: "Real-time attendance monitoring with geo-fencing, biometric integrations, and seamless leave management capabilities.",
        icon: "CalendarCheck"
      },
      {
        id: "3",
        title: "Automate Payroll",
        description: "Generate error-free payroll in minutes with automated tax compliance, deductions, and direct bank transfer integrations.",
        icon: "CircleDollarSign"
      },
      {
        id: "4",
        title: "Monitor Performance",
        description: "Track key performance indicators, set employee goals, and conduct continuous 360-degree performance reviews effortlessly.",
        icon: "TrendingUp"
      },
      {
        id: "5",
        title: "Internal Announcements",
        description: "Communicate effectively with your entire workforce using targeted announcements, policies, and interactive company boards.",
        icon: "Megaphone"
      }
    ]);

    const announcements = parseOrDefault('LOGIN_ANNOUNCEMENTS', [
      { id: "1", title: "Version 1.0 Release", date: new Date().toISOString() },
      { id: "2", title: "System Maintenance Scheduled", date: new Date(Date.now() + 86400000).toISOString() }
    ]);

    const statistics = parseOrDefault('LOGIN_STATISTICS', [
      { id: "1", value: "5000+", label: "Employees" },
      { id: "2", value: "98%", label: "Attendance" },
      { id: "3", value: "24x7", label: "Support" },
      { id: "4", value: "35+", label: "Modules" }
    ]);

    res.status(200).json(new ApiResponse(true, 'Login content fetched successfully', {
      heroSlides,
      announcements,
      statistics,
      version: "1.0.0"
    }));
  } catch (error) {
    next(error);
  }
};
