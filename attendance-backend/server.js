const express = require("express");
const multer = require("multer");
const pdf = require("pdf-parse");

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer to use memory storage to avoid saving files to disk.
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

/**
 * Normalizes the course name from the detailed PDF table and identifies the lecture type.
 * @param {string} rawName - The course name string from the PDF table (e.g., "Cloud ComputingT1 BTI Comp B").
 * @returns {{name: string, type: 'THEO' | 'PRAC'}} - An object with the standardized course name and its type.
 */
function normalizeCourseInfo(rawName) {
  const upperCaseName = rawName.toUpperCase();
  let courseName = "Unknown";

  // Identify course name
  if (upperCaseName.includes("UNIVERSAL HUMAN VALUES-II")) {
    courseName = "Universal Human Values-II";
  } else if (upperCaseName.includes("NATURAL LANGUAGE PROC")) {
    // Handles "Procsg" and "Procesg"
    courseName = "Natural Language Processing";
  } else if (upperCaseName.includes("IOT AND APPLICATIONS")) {
    courseName = "IoT and Applications";
  } else if (upperCaseName.includes("BIG DATA ANALYTICS")) {
    courseName = "Big Data Analytics";
  } else if (upperCaseName.includes("CLOUD COMPUTING")) {
    courseName = "Cloud Computing";
  }

  // Identify lecture type. 'P' in codes like 'P1' denotes Practical. Otherwise, it's Theory.
  const lectureType = /P\d/.test(upperCaseName) ? "PRAC" : "THEO";

  return { name: courseName, type: lectureType };
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

function processAttendanceData(text) {
  const attendanceAgg = {};

  // Find the start of the table data, which is after the header "Attenda nce"
  const tableStartIndex = text.indexOf("Attendance");
  if (tableStartIndex === -1) {
    return []; // No table found
  }
  const tableText = text.substring(tableStartIndex + "Attenda nce".length);

  // Split the entire table text into individual records.
  // The pattern looks for a newline followed by a number, which typically starts a new row.
  const records = tableText
    .split(/(?=\n\s*\d+\s+)/)
    .filter((r) => r.trim() !== "");

  for (const record of records) {
    // For each record, replace newlines with spaces and collapse whitespace to get a clean, single line.
    const cleanRecord = record.replace(/\n/g, " ").trim().replace(/\s+/g, " ");

    // This regex captures the main parts from the now-cleaned record string.
    const match = cleanRecord.match(
      /^(\d+)\s+(.*?)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}).*?\s+([AP])$/
    );

    if (match) {
      const [, srNo, rawCourseName, date, status] = match;
      const { name, type } = normalizeCourseInfo(rawCourseName);

      if (name === "Unknown") continue;

      // Initialize objects if they don't exist
      if (!attendanceAgg[name]) {
        attendanceAgg[name] = {};
      }
      if (!attendanceAgg[name][type]) {
        attendanceAgg[name][type] = { conducted: 0, attended: 0 };
      }

      // Increment counts based on the record
      attendanceAgg[name][type].conducted++;
      if (status === "P") {
        attendanceAgg[name][type].attended++;
      }
    }
  }

  const courseSummary = [];
  let sNo = 1;
  const courseOrder = [
    "Cloud Computing",
    "Big Data Analytics",
    "IoT and Applications",
    "Natural Language Processing",
    "Universal Human Values-II",
  ];

  for (const courseName of courseOrder) {
    if (attendanceAgg[courseName]) {
      const courseData = attendanceAgg[courseName];
      const lectureTypes = [];
      let totalConducted = 0;
      let totalAttended = 0;

      const lectureTypeOrder = ["THEO", "PRAC"];
      for (const type of lectureTypeOrder) {
        if (courseData[type]) {
          const { conducted, attended } = courseData[type];
          totalConducted += conducted;
          totalAttended += attended;

          lectureTypes.push({
            type: type,
            totalClassesConducted: conducted,
            totalClassesAttended: attended,
            percentage:
              conducted > 0
                ? parseFloat(((attended / conducted) * 100).toFixed(2))
                : 0,
          });
        }
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

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
