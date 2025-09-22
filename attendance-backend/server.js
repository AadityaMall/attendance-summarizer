const express = require("express");
const multer = require("multer");
const pdf = require("pdf-parse");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Configure multer to use memory storage (no files on disk)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

function normalizeCourseInfo(rawName) {
  const upperCaseName = rawName.toUpperCase();
  const lectureType = /P\d/.test(upperCaseName) ? "PRAC" : "THEO";
  const splitIdx = upperCaseName.search(/[TP]\d/);
  const base = splitIdx > -1 ? rawName.slice(0, splitIdx) : rawName;
  const courseName = base.replace(/\s+/g, " ").trim();
  return {
    name: courseName.length ? courseName : "Unknown",
    type: lectureType,
  };
}

function extractStudentInfo(text) {
  const cleanText = text.replace(/\n/g, " ").replace(/\s+/g, " ");
  const getMatch = (regex) => {
    const match = cleanText.match(regex);
    return match ? match[1].trim() : null;
  };

  return {
    studentNumber: getMatch(/(\d{11})\s*Student Number/),
    studentName: getMatch(/([A-Z ]+)Student Name/),
    rollNo: getMatch(/([A-Z0-9]+)\s+Roll No\./),
    programName: getMatch(/Roll No\.\s+(.+?)\s+Program Name/),
    academicYear: getMatch(/Acad \.Year\s+(\d{4}-\d{4})/),
    academicSession: getMatch(/Semester\s*([A-Z0-9]+)\s*Academic Session/),
    reportDate: getMatch(/(\w+\s+\d{1,2},\s+\d{4})Date of Report Generation/),
    reportPeriod: getMatch(
      /period\s+(\d{2}\.\d{2}\.\d{4}\s*T[oο]\s*\d{2}\.\d{2}\.\d{4})/i
    ),
  };
}

function processAttendanceData(text) {
  const attendanceAgg = {};
  const absentDetails = {};
  const lines = text.split(/\r?\n/);
  let scanning = false;
  const records = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!scanning) {
      if (line === "Course Name") scanning = true;
      continue;
    }
    if (/^\d+$/.test(line)) {
      if (current && current.parts.length > 0) {
        records.push({ parts: current.parts.slice(), hasNU: current.hasNU });
      }
      current = { parts: [], hasNU: false };
      continue;
    }
    if (!current) continue;
    if (/^[AP]$/.test(line)) {
      current.parts.push(line);
      records.push({ parts: current.parts.slice(), hasNU: current.hasNU });
      current = null;
      continue;
    }
    if (!line) continue;
    if (/\bNU\b/.test(line)) current.hasNU = true;
    current.parts.push(line);
  }
  if (current && current.parts.length > 0) {
    records.push({ parts: current.parts.slice(), hasNU: current.hasNU });
  }
  console.log(`Parsed ${records.length} attendance records.`);
  console.log(records[0]);
  for (const rec of records) {
    if (rec.hasNU) continue;
    const parts = rec.parts;
    if (parts.length < 2) continue;

    const status = /^(A|P)$/.test(parts[parts.length - 1])
      ? parts[parts.length - 1]
      : null;

    

    const dateIdx = parts.findIndex((p) =>
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}$/.test(
        p
      )
    );

    const courseSlice =
      dateIdx > 0
        ? parts.slice(0, dateIdx)
        : parts.slice(0, parts.length - (status ? 1 : 0));

    const rawCourseName = courseSlice.join(" ").replace(/\s+/g, " ").trim();
    if (!rawCourseName) continue;

    const { name, type } = normalizeCourseInfo(rawCourseName);
    if (name === "Unknown") continue;

    if (!attendanceAgg[name]) {
      attendanceAgg[name] = {};
    }
    if (!attendanceAgg[name][type])
      attendanceAgg[name][type] = { conducted: 0, attended: 0 };

    attendanceAgg[name][type].conducted++;
    if (status === "P") {
      attendanceAgg[name][type].attended++;
    } else if (status === "A") {
      attendanceAgg[name].absentDetails =
        attendanceAgg[name].absentDetails || [];
      attendanceAgg[name].absentDetails.push({ type, date });
    }
  }

  const courseSummary = [];
  let sNo = 1;
  for (const courseName of Object.keys(attendanceAgg)) {
    const courseData = attendanceAgg[courseName];
    let totalConducted = 0;
    let totalAttended = 0;
    const lectureTypes = [];

    for (const type of ["THEO", "PRAC"]) {
      if (!courseData[type]) continue;
      const { conducted, attended } = courseData[type];
      totalConducted += conducted;
      totalAttended += attended;
      lectureTypes.push({
        type,
        totalClassesConducted: conducted,
        totalClassesAttended: attended,
        percentage:
          conducted > 0
            ? parseFloat(((attended / conducted) * 100).toFixed(2))
            : 0,
      });
    }

    const overallPercentage =
      totalConducted > 0
        ? parseFloat(((totalAttended / totalConducted) * 100).toFixed(2))
        : 0;

    courseSummary.push({
      sNo: sNo++,
      courseName,
      lectureTypes,
      overallPercentage,
    });
  }

  return courseSummary;
}

// POST endpoint to upload and process the PDF
app.post(
  "/api/attendance",
  upload.single("attendanceFile"),
  async (req, res) => {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded." });
    }
    if (req.file.mimetype !== "application/pdf") {
      return res.status(400).json({
        success: false,
        message: "Invalid file type. Please upload a PDF.",
      });
    }

    try {
      const dataBuffer = req.file.buffer;
      const pdfData = await pdf(dataBuffer);
      const textContent = pdfData.text;

      const studentInfo = extractStudentInfo(textContent);
      const courseSummary = processAttendanceData(textContent);

      if (!studentInfo.studentNumber) {
        return res.status(400).json({
          success: false,
          message:
            "Could not parse student information from the PDF. The file might be in an unsupported format.",
        });
      }

      res.json({
        success: true,
        data: {
          studentInfo,
          courseSummary,
        },
      });
    } catch (error) {
      console.error("Error processing PDF:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to process PDF file." });
    }
  }
);

// Simple health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ ok: true });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

module.exports = app;
