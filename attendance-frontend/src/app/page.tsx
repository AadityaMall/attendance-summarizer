"use client";
import { useMemo, useState } from "react";
import AttendanceTable, { AttendanceRow } from "@/components/AttendanceTable";

type StudentInfo = {
  studentNumber: string;
  studentName: string;
  rollNo: string;
  programName: string;
  academicYear: string;
  academicSession: string;
  reportDate: string;
  reportPeriod: string;
};

type LectureType = {
  type: "THEO" | "PRAC";
  totalClassesConducted: number;
  totalClassesAttended: number;
  percentage: number;
};

type CourseRow = {
  sNo: number;
  courseName: string;
  lectureTypes: LectureType[];
  overallPercentage: number;
};

type ApiResponse = {
  success: boolean;
  data?: {
    studentInfo: StudentInfo;
    courseSummary: CourseRow[];
  };
  message?: string;
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse["data"] | null>(null);
  const [endDate, setEndDate] = useState<string>("");

  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000/";


  const handleUpload = async () => {
    setError(null);
    setResult(null);
    if (!file) {
      setError("Please choose a PDF file.");
      return;
    }
    setLoading(true);
    try {
      const body = new FormData();
      body.append("attendanceFile", file);
      const url = `${backendUrl}api/attendance`;
      const res = await fetch(url, { method: "POST", body });
      const json: ApiResponse = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || "Upload failed");
      }
      setResult(json.data!);
    } catch (e: any) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0f0f10] to-[#111827] text-white px-6 py-10">
      <div className="max-w-5xl mx-auto">
        <header className="mb-8 text-center">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Attendance Summary
          </h1>
          <p className="text-sm text-white/70 mt-2">
            Upload your SVKM attendance PDF to get a clean summary.
          </p>
        </header>

        <section className="rounded-2xl bg-white/5 border border-white/10 p-5 sm:p-6 backdrop-blur-md">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4">
            <div className="flex-1">
              <label className="block text-xs uppercase tracking-wide text-white/70 mb-2">
                PDF file
              </label>
              <div className="relative">
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-500 file:text-white file:px-4 file:py-2 file:text-sm file:cursor-pointer file:hover:bg-indigo-400 block w-full text-sm text-white/90 bg-black/20 rounded-lg border border-white/10 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            <button
              onClick={handleUpload}
              disabled={loading}
              className="h-10 sm:h-11 px-5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {loading ? "Processing..." : "Upload & Summarize"}
            </button>
          </div>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        </section>

        {result && (
          <section className="mt-8 space-y-6">
            <div className="rounded-2xl bg-white/5 border border-white/10 p-5 sm:p-6">
              <h2 className="text-lg font-semibold mb-4">Student</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <Info label="Name" value={result.studentInfo.studentName} />
                <Info label="Roll No." value={result.studentInfo.rollNo} />
                <Info
                  label="Student No."
                  value={result.studentInfo.studentNumber}
                />
                <Info label="Program" value={result.studentInfo.programName} />
                <Info
                  label="Academic Year"
                  value={result.studentInfo.academicYear}
                />
                <Info
                  label="Session"
                  value={result.studentInfo.academicSession}
                />
                <Info
                  label="Report Date"
                  value={result.studentInfo.reportDate}
                />
                <Info label="Period" value={result.studentInfo.reportPeriod} />
              </div>
            </div>

            <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
              <h2 className="text-lg font-semibold">Courses</h2>
              <AttendanceTable rows={toRows(result.courseSummary)} />
            </div>
          </section>
        )}

        {!result && (
          <p className="mt-8 text-center text-white/60 text-sm">
            No report yet. Upload your PDF to see the summary.
          </p>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-black/20 border border-white/10 px-3 py-2">
      <span className="text-white/60 text-xs uppercase tracking-wide">
        {label}
      </span>
      <span className="font-medium">{value}</span>
    </div>
  );
}



function toRows(courses: CourseRow[]): AttendanceRow[] {
  return courses.map((c) => {
    const theo = c.lectureTypes.find((t) => t.type === "THEO")
      ? {
          conducted: c.lectureTypes.find((t) => t.type === "THEO")!
            .totalClassesConducted,
          attended: c.lectureTypes.find((t) => t.type === "THEO")!
            .totalClassesAttended,
        }
      : null;
    const pracEntry = c.lectureTypes.find((t) => t.type === "PRAC");
    const prac = pracEntry
      ? {
          conducted: pracEntry.totalClassesConducted,
          attended: pracEntry.totalClassesAttended,
        }
      : null;
    return {
      sno: c.sNo,
      course: c.courseName,
      theo,
      prac,
      percent: c.overallPercentage,
    };
  });
}
