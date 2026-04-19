const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;
const DEFAULT_MAIL_DELAY_MINUTES = 30;
const QUESTION_CACHE_SECONDS = 10 * 60;

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const action = String((e.parameter && e.parameter.action) || "").trim();

  if (action === "publicExamMeta") {
    return getPublicExamMetaResponse_(ss, e.parameter.examId);
  }

  if (action === "studentExam") {
    return getStudentExamResponse_(ss, e.parameter.examId);
  }

  if (action === "attemptStatus") {
    return getAttemptStatusResponse_(ss, e.parameter.examId, e.parameter.appId);
  }

  return textResponse_("Invalid request");
}

function doPost(e) {
  const data = JSON.parse((e.postData && e.postData.contents) || "{}");
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const type = String(data.type || "").trim();

  if (type === "login") {
    return adminLogin_(ss, data);
  }

  if (type === "createExam") {
    return createExamResponse_(ss, data);
  }

  if (type === "getAdminExams") {
    return getAdminExamsResponse_(ss, data);
  }

  if (type === "getExamDetails") {
    return getExamDetailsResponse_(ss, data);
  }

  if (type === "saveExamSettings") {
    return saveExamSettingsResponse_(ss, data);
  }

  if (type === "bulkQuestions") {
    return bulkUploadQuestions_(ss, data);
  }

  if (type === "saveResult") {
    return saveResultResponse_(ss, data);
  }

  return textResponse_("Invalid request");
}
function saveResult(data) {

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Results");

  const submissionId = data.id;

  const allData = sheet.getDataRange().getValues();

  for (let i = 1; i < allData.length; i++) {
    if (allData[i][0] == submissionId) {
      return { status: "duplicate" };
    }
  }

  sheet.appendRow([
    submissionId,
    new Date(),
    data.examId,
    data.name,
    data.appId,
    data.email,
    data.score,
    data.percent,
    data.total,
    JSON.stringify(data.questions)
  ]);

  return { status: "saved" };
}


function getPublicExamMetaResponse_(ss, examId) {
  const exam = getExamById_(ss, examId);
  if (!exam) {
    return jsonResponse_({ status: "not_found" });
  }

  return jsonResponse_({
    status: getExamWindowStatus_(exam),
    exam: sanitizeExamForStudent_(exam)
  });
}

function getStudentExamResponse_(ss, examId) {
  const exam = getExamById_(ss, examId);
  if (!exam) {
    return jsonResponse_({ status: "not_found" });
  }

  const status = getExamWindowStatus_(exam);
  if (status !== "open") {
    return jsonResponse_({
      status: status,
      exam: sanitizeExamForStudent_(exam)
    });
  }

  return jsonResponse_({
    status: "open",
    exam: sanitizeExamForStudent_(exam),
    questions: getQuestionsForExam_(ss, exam.examId)
  });
}

function getAttemptStatusResponse_(ss, examId, appId) {
  if (!examId || !appId) {
    return textResponse_("invalid");
  }

  const sheet = ss.getSheetByName("Results");
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === String(examId).trim() && String(data[i][4]).trim() === String(appId).trim()) {
      return textResponse_("exists");
    }
  }

  return textResponse_("ok");
}

function adminLogin_(ss, data) {
  const username = String(data.username || "").trim();
  const password = String(data.password || "");

  if (!username || !password) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const adminSheet = ss.getSheetByName("Admin");
  const adminData = adminSheet.getDataRange().getValues();
  const passwordHash = hashPassword_(password);

  for (let i = 1; i < adminData.length; i++) {
    const rowUsername = String(adminData[i][0] || "").trim();
    const rowPasswordHash = String(adminData[i][1] || "").trim();
    const isActive = String(adminData[i][2] || "YES").toUpperCase() !== "NO";

    if (rowUsername === username && rowPasswordHash === passwordHash && isActive) {
      const sessionToken = Utilities.getUuid();
      CacheService.getScriptCache().put(
        "admin_session_" + sessionToken,
        JSON.stringify({ username: username }),
        ADMIN_SESSION_TTL_SECONDS
      );

      return jsonResponse_({
        status: "success",
        sessionToken: sessionToken,
        expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000).toISOString()
      });
    }
  }

  return jsonResponse_({ status: "unauthorized" });
}

function createExamResponse_(ss, data) {
  const session = verifyAdminSession_(data.adminToken);
  if (!session) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const settings = normalizeExamSettings_(data.settings || {});
  if (!settings.valid) {
    return jsonResponse_({ status: "invalid_settings", message: settings.message });
  }

  const examsSheet = ss.getSheetByName("Exams");
  const examId = createExamId_();

  examsSheet.appendRow([
    examId,
    session.username,
    settings.examTitle,
    settings.examSubtitle,
    settings.examStart,
    settings.examEnd,
    settings.mailDelayMinutes,
    settings.durationMinutes,
    settings.questionLimit,
    settings.passPercentage,
    settings.appIdPrefix,
    "YES",
    new Date()
  ]);

  return jsonResponse_({
    status: "success",
    examId: examId,
    exam: getExamById_(ss, examId)
  });
}

function getAdminExamsResponse_(ss, data) {
  const session = verifyAdminSession_(data.adminToken);
  if (!session) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const examsSheet = ss.getSheetByName("Exams");
  const rows = examsSheet.getDataRange().getValues();
  const exams = [];

  for (let i = 1; i < rows.length; i++) {
    const exam = examFromRow_(rows[i], i + 1);
    if (exam.teacherUsername === session.username) {
      exams.push({
        examId: exam.examId,
        examTitle: exam.examTitle,
        examSubtitle: exam.examSubtitle,
        examStart: exam.examStart.toISOString(),
        examEnd: exam.examEnd.toISOString(),
        active: exam.active,
        questionCount: getQuestionCountForExam_(ss, exam.examId),
        examLink: buildExamLink_(exam.examId)
      });
    }
  }

  exams.sort(function(a, b) {
    return new Date(b.examStart) - new Date(a.examStart);
  });

  return jsonResponse_({ status: "success", exams: exams });
}

function getExamDetailsResponse_(ss, data) {
  const session = verifyAdminSession_(data.adminToken);
  if (!session) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const exam = getExamById_(ss, data.examId);
  if (!exam || exam.teacherUsername !== session.username) {
    return jsonResponse_({ status: "not_found" });
  }

  return jsonResponse_({
    status: "success",
    exam: exam,
    questionCount: getQuestionCountForExam_(ss, exam.examId),
    examLink: buildExamLink_(exam.examId)
  });
}

function saveExamSettingsResponse_(ss, data) {
  const session = verifyAdminSession_(data.adminToken);
  if (!session) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const exam = getExamById_(ss, data.examId);
  if (!exam || exam.teacherUsername !== session.username) {
    return jsonResponse_({ status: "not_found" });
  }

  const settings = normalizeExamSettings_(data.settings || {});
  if (!settings.valid) {
    return jsonResponse_({ status: "invalid_settings", message: settings.message });
  }

  const examsSheet = ss.getSheetByName("Exams");
  const row = exam.rowIndex;
  examsSheet.getRange(row, 3).setValue(settings.examTitle);
  examsSheet.getRange(row, 4).setValue(settings.examSubtitle);
  examsSheet.getRange(row, 5).setValue(settings.examStart);
  examsSheet.getRange(row, 6).setValue(settings.examEnd);
  examsSheet.getRange(row, 7).setValue(settings.mailDelayMinutes);
  examsSheet.getRange(row, 8).setValue(settings.durationMinutes);
  examsSheet.getRange(row, 9).setValue(settings.questionLimit);
  examsSheet.getRange(row, 10).setValue(settings.passPercentage);
  examsSheet.getRange(row, 11).setValue(settings.appIdPrefix);
  examsSheet.getRange(row, 12).setValue(data.active === false ? "NO" : "YES");

  return jsonResponse_({
    status: "success",
    exam: getExamById_(ss, data.examId)
  });
}

function bulkUploadQuestions_(ss, data) {
  const session = verifyAdminSession_(data.adminToken);
  if (!session) {
    return jsonResponse_({ status: "unauthorized" });
  }

  const exam = getExamById_(ss, data.examId);
  if (!exam || exam.teacherUsername !== session.username) {
    return jsonResponse_({ status: "not_found" });
  }

  const text = String(data.data || "").trim();
  if (!text) {
    return jsonResponse_({ status: "invalid_questions" });
  }

  const lines = text.split("\n");
  const rows = [];
  let questionLines = [];
  let options = [];
  let answer = "";

  lines.forEach(function(line) {
    line = String(line).trim();

    if (!line) {
      return;
    }

    if (line.startsWith("A.") || line.startsWith("B.") || line.startsWith("C.") || line.startsWith("D.")) {
      options.push(line.substring(3));
      return;
    }

    if (line.startsWith("Answer:")) {
      answer = line.replace("Answer:", "").trim();
      rows.push([
        exam.examId,
        questionLines.join("\n"),
        options[0] || "",
        options[1] || "",
        options[2] || "",
        options[3] || "",
        answer
      ]);
      questionLines = [];
      options = [];
      answer = "";
      return;
    }

    questionLines.push(line);
  });

  if (questionLines.length > 0) {
    rows.push([
      exam.examId,
      questionLines.join("\n"),
      options[0] || "",
      options[1] || "",
      options[2] || "",
      options[3] || "",
      answer || ""
    ]);
  }

  if (!rows.length) {
    return jsonResponse_({ status: "invalid_questions" });
  }

  const questionsSheet = ss.getSheetByName("Questions");
  const startRow = questionsSheet.getLastRow() + 1;
  questionsSheet.getRange(startRow, 1, rows.length, 7).setValues(rows);
  CacheService.getScriptCache().remove("questions_" + exam.examId);

  return jsonResponse_({
    status: "uploaded",
    count: rows.length,
    examId: exam.examId
  });
}

function saveResultResponse_(ss, data) {

  const exam = getExamById_(ss, data.examId);
  if (!exam) {
    return jsonResponse_({ status: "not_found" });
  }

  const resultsSheet = ss.getSheetByName("Results");

  const submissionId = data.id;

  // 🔍 CHECK DUPLICATE
  const allData = resultsSheet.getDataRange().getValues();

  for (let i = 1; i < allData.length; i++) {
    if (allData[i][0] == submissionId) {
      return jsonResponse_({ status: "duplicate" });
    }
  }

  // ✅ SAVE (with submissionId as first column)
  resultsSheet.appendRow([
    submissionId,                 // NEW COLUMN A
    new Date(),
    exam.examId,
    exam.teacherUsername,
    data.name,
    data.appId,
    data.email,
    data.score,
    data.percent,
    data.total,
    JSON.stringify(data.questions || []),
    "NO"
  ]);

  return jsonResponse_({ status: "saved" });
}
function checkAndSendEmails() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultsSheet = ss.getSheetByName("Results");
  const rows = resultsSheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < rows.length; i++) {
    const submitTime = new Date(rows[i][0]);
    const examId = String(rows[i][1] || "").trim();
    const studentName = rows[i][3];
    const appId = rows[i][4];
    const email = rows[i][5];
    const score = rows[i][6];
    const percent = rows[i][7];
    const total = rows[i][8];
    const answers = JSON.parse(rows[i][9] || "[]");
    const emailSent = rows[i][10] || "NO";
    const exam = getExamById_(ss, examId);

    if (!exam || emailSent === "YES") {
      continue;
    }

    const diff = (now - submitTime) / 60000;
    if (diff < exam.mailDelayMinutes) {
      continue;
    }

    let html = ""
      + "<h2>Exam Response Sheet</h2>"
      + "<p><b>Exam:</b> " + exam.examTitle + "</p>"
      + "<p><b>Name:</b> " + studentName + "</p>"
      + "<p><b>Application ID:</b> " + appId + "</p>"
      + "<p><b>Score:</b> " + score + "/" + total + "</p>"
      + "<p><b>Percentage:</b> " + percent + "%</p>"
      + "<hr><ol>";

    answers.forEach(function(q) {
      const options = Array.isArray(q.options) ? q.options : [];
      let optionHtml = "<ul>";

      options.forEach(function(option) {
        const markers = [];
        if (option === q.chosen) {
          markers.push("Your Answer");
        }
        if (option === q.correct) {
          markers.push("Correct Answer");
        }

        optionHtml += "<li>" + option + (markers.length ? " <b>(" + markers.join(", ") + ")</b>" : "") + "</li>";
      });

      optionHtml += "</ul>";

      html += ""
        + "<li><b>" + q.question + "</b><br>"
        + optionHtml
        + "Your Answer: " + q.chosen + "<br>"
        + "Correct Answer: " + q.correct + "</li><br>";
    });

    html += "</ol>";

    const blob = Utilities.newBlob(html, "text/html");
    const pdf = blob.getAs("application/pdf").setName(examId + "_" + appId + "_ResponseSheet.pdf");

    MailApp.sendEmail({
      to: email,
      subject: exam.examTitle + " Response Sheet",
      htmlBody: "Please find your response sheet attached.",
      attachments: [pdf]
    });

    resultsSheet.getRange(i + 1, 11).setValue("YES");
  }
}

function getExamById_(ss, examId) {
  const safeExamId = String(examId || "").trim();
  if (!safeExamId) {
    return null;
  }

  const examsSheet = ss.getSheetByName("Exams");
  const rows = examsSheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    const exam = examFromRow_(rows[i], i + 1);
    if (exam.examId === safeExamId) {
      return exam;
    }
  }

  return null;
}

function examFromRow_(row, rowIndex) {
  return {
    rowIndex: rowIndex,
    examId: String(row[0] || "").trim(),
    teacherUsername: String(row[1] || "").trim(),
    examTitle: String(row[2] || "Untitled Exam").trim(),
    examSubtitle: String(row[3] || "Answer each question carefully").trim(),
    examStart: safeDate_(row[4], new Date()),
    examEnd: safeDate_(row[5], new Date(Date.now() + 60 * 60 * 1000)),
    mailDelayMinutes: Math.max(0, Number(row[6]) || DEFAULT_MAIL_DELAY_MINUTES),
    durationMinutes: Math.max(1, Number(row[7]) || 10),
    questionLimit: Math.max(1, Number(row[8]) || 10),
    passPercentage: Math.min(100, Math.max(1, Number(row[9]) || 50)),
    appIdPrefix: String(row[10] || "CDS").trim().toUpperCase(),
    active: String(row[11] || "YES").toUpperCase() !== "NO",
    createdAt: safeDate_(row[12], new Date())
  };
}

function sanitizeExamForStudent_(exam) {
  return {
    examId: exam.examId,
    examTitle: exam.examTitle,
    examSubtitle: exam.examSubtitle,
    examStart: exam.examStart.toISOString(),
    examEnd: exam.examEnd.toISOString(),
    durationMinutes: exam.durationMinutes,
    questionLimit: exam.questionLimit,
    passPercentage: exam.passPercentage,
    appIdPrefix: exam.appIdPrefix,
    active: exam.active
  };
}

function getExamWindowStatus_(exam) {
  const now = new Date();
  if (!exam.active) {
    return "inactive";
  }
  if (now < exam.examStart) {
    return "before";
  }
  if (now > exam.examEnd) {
    return "after";
  }
  return "open";
}

function getQuestionsForExam_(ss, examId) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "questions_" + examId;
  const cached = cache.get(cacheKey);

  if (cached) {
    return JSON.parse(cached);
  }

  const questionsSheet = ss.getSheetByName("Questions");
  const rows = questionsSheet.getDataRange().getValues();
  const questions = [];

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || "").trim() !== String(examId).trim()) {
      continue;
    }

    const options = [rows[i][2], rows[i][3], rows[i][4], rows[i][5]];
    let answer = String(rows[i][6] || "").trim();

    if (answer === "A") answer = options[0];
    if (answer === "B") answer = options[1];
    if (answer === "C") answer = options[2];
    if (answer === "D") answer = options[3];

    questions.push({
      q: rows[i][1],
      options: options,
      answer: answer
    });
  }

  cache.put(cacheKey, JSON.stringify(questions), QUESTION_CACHE_SECONDS);
  return questions;
}

function getQuestionCountForExam_(ss, examId) {
  const questionsSheet = ss.getSheetByName("Questions");
  const rows = questionsSheet.getDataRange().getValues();
  let count = 0;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || "").trim() === String(examId).trim()) {
      count += 1;
    }
  }

  return count;
}

function normalizeExamSettings_(settings) {
  const examTitle = String(settings.examTitle || "").trim();
  const examSubtitle = String(settings.examSubtitle || "Answer each question carefully").trim();
  const appIdPrefix = String(settings.appIdPrefix || "CDS").trim().toUpperCase();
  const examStart = new Date(settings.examStart);
  const examEnd = new Date(settings.examEnd);
  const mailDelayMinutes = Math.max(0, Number(settings.mailDelayMinutes) || DEFAULT_MAIL_DELAY_MINUTES);
  const durationMinutes = Math.max(1, Number(settings.durationMinutes) || 10);
  const questionLimit = Math.max(1, Number(settings.questionLimit) || 10);
  const passPercentage = Math.min(100, Math.max(1, Number(settings.passPercentage) || 50));

  if (!examTitle) {
    return { valid: false, message: "Exam title is required." };
  }

  if (isNaN(examStart.getTime()) || isNaN(examEnd.getTime()) || examEnd <= examStart) {
    return { valid: false, message: "Exam start and end times are invalid." };
  }

  return {
    valid: true,
    examTitle: examTitle,
    examSubtitle: examSubtitle,
    examStart: examStart,
    examEnd: examEnd,
    mailDelayMinutes: mailDelayMinutes,
    durationMinutes: durationMinutes,
    questionLimit: questionLimit,
    passPercentage: passPercentage,
    appIdPrefix: appIdPrefix || "CDS"
  };
}

function createExamId_() {
  return "EXAM-" + Utilities.getUuid().split("-")[0].toUpperCase();
}

function buildExamLink_(examId) {
  return "index.html?examId=" + encodeURIComponent(examId);
}

function verifyAdminSession_(token) {
  const safeToken = String(token || "").trim();
  if (!safeToken) {
    return null;
  }

  const cached = CacheService.getScriptCache().get("admin_session_" + safeToken);
  return cached ? JSON.parse(cached) : null;
}

function hashPassword_(plainText) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    plainText,
    Utilities.Charset.UTF_8
  );

  return bytes.map(function(byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ("0" + normalized.toString(16)).slice(-2);
  }).join("");
}

function setAdminPassword(username, newPassword) {
  if (!username || !newPassword) {
    throw new Error("Username and password are required.");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const adminSheet = ss.getSheetByName("Admin");
  const rows = adminSheet.getDataRange().getValues();
  const passwordHash = hashPassword_(newPassword);

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0] || "").trim() === String(username).trim()) {
      adminSheet.getRange(i + 1, 2).setValue(passwordHash);
      adminSheet.getRange(i + 1, 3).setValue("YES");
      return "updated";
    }
  }

  adminSheet.appendRow([username, passwordHash, "YES"]);
  return "created";
}

function setupAdmin() {
  return setAdminPassword("admin", "quiz123");
}

function setupSheetHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheetByName("Exams").getRange(1, 1, 1, 13).setValues([[
    "exam_id",
    "teacher_username",
    "exam_title",
    "exam_subtitle",
    "exam_start",
    "exam_end",
    "mail_delay_minutes",
    "duration_minutes",
    "question_limit",
    "pass_percentage",
    "app_id_prefix",
    "active",
    "created_at"
  ]]);

  ss.getSheetByName("Questions").getRange(1, 1, 1, 7).setValues([[
    "exam_id",
    "question",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "answer"
  ]]);

  ss.getSheetByName("Results").getRange(1, 1, 1, 11).setValues([[
    "submit_time",
    "exam_id",
    "teacher_username",
    "student_name",
    "app_id",
    "email",
    "score",
    "percent",
    "total",
    "answers_json",
    "mail_sent"
  ]]);

  ss.getSheetByName("Admin").getRange(1, 1, 1, 3).setValues([[
    "username",
    "password_hash",
    "active"
  ]]);

  return "headers_ready";
}

function safeDate_(value, fallback) {
  const date = new Date(value);
  return isNaN(date.getTime()) ? new Date(fallback) : date;
}

function jsonResponse_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function textResponse_(text) {
  return ContentService
    .createTextOutput(text)
    .setMimeType(ContentService.MimeType.TEXT);
}
