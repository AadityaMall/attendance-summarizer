const express = require("express");
const multer = require("multer");
const pdf = require("pdf-parse");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  })
);

// Configure multer to use memory storage to avoid saving files to disk.
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

function normalizeCourseInfo(rawName) {
  const upperCaseName = rawName.toUpperCase();
  // Detect lecture token
  const tokenMatch = upperCaseName.match(/([TP])\d/);
  const lectureType = tokenMatch && tokenMatch[1] === "P" ? "PRAC" : "THEO";
  // Extract base course name before the lecture token like T1/P1
  const splitIdx = upperCaseName.search(/[TP]\d/);
  const base = splitIdx > -1 ? rawName.slice(0, splitIdx) : rawName;
  // Normalize excessive whitespace and joined words broken by newlines
  const courseName = standardizeCourseName(
    base
      .replace(/\s+/g, " ")
      .replace(/\s*-\s*/g, "-")
      .trim()
  );
  return { name: courseName.length ? courseName : "Unknown", type: lectureType };
}


function extractStudentInfo(text) {
  // Clean the text by replacing newlines with spaces and collapsing multiple spaces.
  const cleanText = text.replace(/\n/g, " ").replace(/\s+/g, " ");

  // For debugging, you can uncomment the line below to see the exact text being parsed.
  // console.log("CLEANED TEXT:", cleanText);

  const getMatch = (regex) => {
    const match = cleanText.match(regex);
    // If a match is found, return the first captured group; otherwise, return null.
    return match ? match[1].trim() : null;
  };

  return {
    studentNumber: getMatch(/(\d{11})\s*Student Number/),

    studentName: getMatch(/([A-Z ]+)Student Name/),

    rollNo: getMatch(/([A-Z0-9]+)\s+Roll No\./),

    programName: getMatch(
      /(B\.Tech \(Comp\. Engg\.\) \(Integrated\))\s+Program Name/
    ),

    academicYear: getMatch(/Acad \.Year\s+(\d{4}-\d{4})/),

    academicSession: getMatch(/Semester\s*([A-Z0-9]+)\s*Academic Session/),

    reportDate: getMatch(/(\w+\s+\d{1,2},\s+\d{4})Date of Report Generation/),

    reportPeriod: getMatch(
      /period\s+(\d{2}\.\d{2}\.\d{4}\s*T[oο]\s*\d{2}\.\d{2}\.\d{4})/i
    ),
  };
}

function processAttendanceData(text, options = {}) {
  const attendanceAgg = {};
  const firstSeenOrder = [];
  const endDateLimit = options.endDateLimit ? parseFlexibleDate(options.endDateLimit) : null;

  // Build records by scanning lines: a record starts with a numeric line, ends at a standalone A/P line
  const lines = text.split(/\r?\n/);
  // Activate scanning only after we cross the table header
  let scanning = false;
  const records = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Detect header block (appears as separate lines: Sr, No., Course Name, Date, Start Time, End Time, Attenda, nce)
    if (!scanning) {
      if (line === 'Course Name') {
        scanning = true;
      }
      continue;
    }
    if (/^\d+$/.test(line)) {
      // Start new record
      if (current && current.parts.length > 0) {
        records.push({ parts: current.parts.slice(), hasNU: current.hasNU });
      }
      current = { parts: [], hasNU: false };
      continue;
    }
    if (!current) continue;
    if (/^[AP]$/.test(line)) {
      // finalize record
      current.parts.push(line);
      records.push({ parts: current.parts.slice(), hasNU: current.hasNU });
      current = null;
      continue;
    }
    if (line.length === 0) continue;
    if (/\bNU\b/.test(line)) current.hasNU = true;
    current.parts.push(line);
  }
  // push last partial if looked like a record and somehow missed status
  if (current && current.parts.length > 0) {
    records.push({ parts: current.parts.slice(), hasNU: current.hasNU });
  }

  for (const rec of records) {
    const parts = rec.parts;
    // parts contains: [course line(s), date line, start time line, end time line, status]
    if (parts.length < 2) continue;
    if (rec.hasNU) continue; // ignore Not Updated entries entirely
    const status = /^(A|P)$/.test(parts[parts.length - 1])
      ? parts[parts.length - 1]
      : null;
    // Find a line that looks like a date e.g., "Jul 14, 2025" and assume course lines come before it
    const dateIdx = parts.findIndex((p) => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}$/.test(p));
    // Optionally filter by end date
    if (dateIdx >= 0 && endDateLimit) {
      const d = parseFlexibleDate(parts[dateIdx]);
      if (d && d > endDateLimit) continue;
    }
    const courseSlice = dateIdx > 0 ? parts.slice(0, dateIdx) : parts.slice(0, parts.length - (status ? 1 : 0));
    const rawCourseName = courseSlice.join(" ");

    const { name, type } = normalizeCourseInfo(rawCourseName);
    if (name === "Unknown") continue;

    if (!attendanceAgg[name]) {
      attendanceAgg[name] = {};
      firstSeenOrder.push(name);
    }
    if (!attendanceAgg[name][type]) attendanceAgg[name][type] = { conducted: 0, attended: 0 };

    attendanceAgg[name][type].conducted++;
    if (status === "P") attendanceAgg[name][type].attended++;
  }

  const courseSummary = [];
  let sNo = 1;
  // Preserve first-seen order dynamically for any course names
  for (const courseName of firstSeenOrder) {
    if (!attendanceAgg[courseName]) continue;
    const courseData = attendanceAgg[courseName];
    const lectureTypes = [];
    let totalConducted = 0;
    let totalAttended = 0;

    for (const type of ["THEO", "PRAC"]) {
      if (!courseData[type]) continue;
      const { conducted, attended } = courseData[type];
      totalConducted += conducted;
      totalAttended += attended;
      lectureTypes.push({
        type,
        totalClassesConducted: conducted,
        totalClassesAttended: attended,
        percentage: conducted > 0 ? parseFloat(((attended / conducted) * 100).toFixed(2)) : 0,
      });
    }

    const overallPercentage = totalConducted > 0 ? parseFloat(((totalAttended / totalConducted) * 100).toFixed(2)) : 0;
    courseSummary.push({ sNo: sNo++, courseName, lectureTypes, overallPercentage });
  }

  return courseSummary;
}

function parseFlexibleDate(s) {
  if (!s) return null;
  // Formats like "Jul 14, 2025"
  const m1 = s.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}$/);
  if (m1) return new Date(s);
  // Formats like 14.07.2025
  const m2 = s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (m2) {
    const [_, dd, mm, yyyy] = m2;
    return new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
  }
  // ISO YYYY-MM-DD
  const m3 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m3) {
    const [_, yyyy, mm, dd] = m3;
    return new Date(parseInt(yyyy, 10), parseInt(mm, 10) - 1, parseInt(dd, 10));
  }
  return null;
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
      const endDate = req.query.endDate; // optional YYYY-MM-DD or DD.MM.YYYY
      const courseSummary = processAttendanceData(textContent, {
        endDateLimit: endDate,
      });

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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  normalizeCourseInfo,
  extractStudentInfo,
  processAttendanceData,
};

function standardizeCourseName(name) {
  const n = name.replace(/\s+/g, " ").trim();
  const u = n.toUpperCase();
  // Fix common OCR variants
  if (/^NATURAL\s+LANGUAGE\s+PROC/i.test(u)) {
    return "Natural Language Processing";
  }
  if (/^UNIVERSAL\s+HUMAN\s+VALUES[-\s]*II$/i.test(u) || u.includes("UNIVERSAL HUMAN VALUES-II")) {
    return "Universal Human Values-II";
  }
  return n;
}
