"use strict";

// Exports per-question scores and grading comments for Classic Quiz assignments.
// Runs on both /courses/:id/assignments/:id and /courses/:id/quizzes/:id.
// Uses the assignment submissions endpoint with include[]=submission_history,
// confirmed to return submission_data[]{question_id, points, more_comments}.
(() => {
  const pathParts = window.location.pathname.split("/");
  const section = pathParts[3]; // "assignments" or "quizzes"

  if (section !== "assignments" && section !== "quizzes") return;

  chrome.storage.sync.get(
    { courseAssignmentExportQuizQuestionScores: true },
    function (items) {
      if (items.courseAssignmentExportQuizQuestionScores) {
        const watchTarget =
          section === "quizzes"
            ? "sidebar_content"
            : "assignment-speedgrader-link";
        SkiMonitorChanges.watchForElementById(watchTarget, checkAndAddButton);
      }
    }
  );

  async function checkAndAddButton() {
    const courseId = pathParts[2];
    let quizId;
    let assignmentId;

    if (section === "quizzes") {
      quizId = pathParts[4];
      const quizResp = await SkiCanvasLmsApiCaller.getRequest(
        `/api/v1/courses/${courseId}/quizzes/${quizId}`
      );
      if (!quizResp?.isSuccessful) return;
      assignmentId = quizResp.results.assignment_id;
      if (!assignmentId) return;
    } else {
      assignmentId = pathParts[4].split("?")[0];
      const resp = await SkiCanvasLmsApiCaller.getRequest(
        `/api/v1/courses/${courseId}/assignments/${assignmentId}`
      );
      if (!resp?.isSuccessful) return;
      quizId = resp.results.quiz_id;
      if (!quizId) return;
    }

    const button = createExportButton(courseId, quizId, assignmentId);
    document
      .getElementById("sidebar_content")
      ?.insertAdjacentElement("beforeend", button);
  }

  function createExportButton(courseId, quizId, assignmentId) {
    const button = document.createElement("button");
    button.innerText = "Export Quiz Question Scores";
    button.classList.add("btn", "button-sidebar-wide");

    button.addEventListener("click", async () => {
      button.disabled = true;
      const originalText = button.innerText;
      try {
        button.innerText = "Fetching questions...";
        const questions = await fetchQuizQuestions(courseId, quizId);
        if (!questions.length) {
          alert("No quiz questions found.");
          return;
        }

        button.innerText = "Fetching submissions...";
        const submissions = await fetchSubmissionsWithHistory(
          courseId,
          assignmentId
        );
        const quizSubmissions = submissions.filter(
          (s) => s.submission_type === "online_quiz"
        );
        if (!quizSubmissions.length) {
          alert("No quiz submissions found.");
          return;
        }

        button.innerText = "Building CSV...";
        const csvString = buildCsv(questions, quizSubmissions);
        downloadCsv(
          csvString,
          `quiz_question_scores_${new Date().toLocaleString()}.csv`
        );
      } catch (e) {
        alert(`Export failed: ${e.message}`);
      } finally {
        button.innerText = originalText;
        button.disabled = false;
      }
    });

    return button;
  }

  async function fetchQuizQuestions(courseId, quizId) {
    return await SkiCanvasLmsApiCaller.getRequestAllPages(
      `/api/v1/courses/${courseId}/quizzes/${quizId}/questions`,
      { per_page: 100 }
    );
  }

  async function fetchSubmissionsWithHistory(courseId, assignmentId) {
    return await SkiCanvasLmsApiCaller.getRequestAllPages(
      `/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`,
      {
        per_page: 100,
        "include[]": ["submission_history", "user"],
      }
    );
  }

  function buildCsv(questions, submissions) {
    const sortedQuestions = [...questions].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0)
    );

    const headerRow = ["student_id", "student_name", "total_score"];
    for (let i = 0; i < sortedQuestions.length; i++) {
      const n = i + 1;
      headerRow.push(`q${n}_score`);
      headerRow.push(`q${n}_comment`);
    }
    const rows = [headerRow.map(csvCell).join(",")];

    for (const submission of submissions) {
      const userId = String(submission.user_id || "");
      const studentName =
        submission.user?.sortable_name || submission.user?.name || "";
      const totalScore = submission.score ?? "";

      // Last entry in submission_history is the graded attempt
      const history = submission.submission_history || [];
      const lastAttempt = history[history.length - 1] || {};
      const submissionData = lastAttempt.submission_data || [];

      const scoresByQuestionId = {};
      for (const item of submissionData) {
        scoresByQuestionId[String(item.question_id)] = {
          score: item.points ?? "",
          comment: item.more_comments ?? "",
        };
      }

      const row = [csvCell(userId), csvCell(studentName), totalScore];
      for (const q of sortedQuestions) {
        const qData = scoresByQuestionId[String(q.id)] || {};
        row.push(qData.score ?? "");
        row.push(csvCell(qData.comment ?? ""));
      }

      rows.push(row.join(","));
    }

    return rows.join("\n");
  }

  function csvCell(value) {
    if (typeof value !== "string") return value ?? "";
    const cleaned = value
      .replace(/(\r\n|\n|\r)/gm, " ")
      .replace(/  +/gm, " ")
      .trim();
    return `"${cleaned.replace(/"/g, '""')}"`;
  }

  function downloadCsv(csvString, filename) {
    const link = document.createElement("a");
    link.style.display = "none";
    link.setAttribute("target", "_blank");
    link.setAttribute(
      "href",
      "data:text/csv;charset=utf-8," + encodeURIComponent(csvString)
    );
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
})();
