"use client";
import React from "react";

export type AttendanceRow = {
  sno: number;
  course: string;
  theo: { conducted: number; attended: number } | null;
  prac?: { conducted: number; attended: number } | null;
  percent: number; // overall percentage
};

export default function AttendanceTable({ rows }: { rows: AttendanceRow[] }) {
  return (
    <table className="table-auto border-collapse border border-gray-400 mt-6 w-full text-sm bg-white/5">
      <thead>
        <tr className="bg-gray-100 text-black">
          <th className="border px-2 py-1">S.No</th>
          <th className="border px-2 py-1">Course Name</th>
          <th className="border px-2 py-1">Lecture Type</th>
          <th className="border px-2 py-1">Total Classes Conducted</th>
          <th className="border px-2 py-1">Total Classes Attended</th>
          <th className="border px-2 py-1">Percentage (%)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <React.Fragment key={row.sno}>
            <tr>
              <td className="border px-2 py-1" rowSpan={row.prac ? 2 : 1}>{row.sno}</td>
              <td className="border px-2 py-1" rowSpan={row.prac ? 2 : 1}>{row.course}</td>
              <td className="border px-2 py-1">THEO</td>
              <td className="border px-2 py-1">{row.theo ? row.theo.conducted : 0}</td>
              <td className="border px-2 py-1">{row.theo ? row.theo.attended : 0}</td>
              <td className="border px-2 py-1" rowSpan={row.prac ? 2 : 1}>{row.percent.toFixed(2)}</td>
            </tr>
            {row.prac && (
              <tr>
                <td className="border px-2 py-1">PRAC</td>
                <td className="border px-2 py-1">{row.prac.conducted}</td>
                <td className="border px-2 py-1">{row.prac.attended}</td>
              </tr>
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}


