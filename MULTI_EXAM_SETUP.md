# Multi-Exam Setup

This project now uses an `exam_id`-based structure so each teacher exam stays separate.

## Required Sheets

- `Admin`
- `Exams`
- `Questions`
- `Results`

## Run These Once In Apps Script

1. `setupSheetHeaders()`
2. `setupAdmin()`

`setupAdmin()` creates:

- username: `admin`
- password: `quiz123`

The password is stored as a hash in the `Admin` sheet.

## Sheet Headers

### `Admin`

- `username`
- `password_hash`
- `active`

### `Exams`

- `exam_id`
- `teacher_username`
- `exam_title`
- `exam_subtitle`
- `exam_start`
- `exam_end`
- `mail_delay_minutes`
- `duration_minutes`
- `question_limit`
- `pass_percentage`
- `app_id_prefix`
- `active`
- `created_at`

### `Questions`

- `exam_id`
- `question`
- `option_a`
- `option_b`
- `option_c`
- `option_d`
- `answer`

### `Results`

- `submit_time`
- `exam_id`
- `teacher_username`
- `student_name`
- `app_id`
- `email`
- `score`
- `percent`
- `total`
- `answers_json`
- `mail_sent`

## Admin Flow

1. Log in on `bulk_admin.html`
2. Create a new exam
3. Select that exam from the dropdown
4. Save its settings if needed
5. Upload questions for that exam only
6. Share the exam link or `exam_id` with students

## Student Flow

Students open:

- `index.html?examId=EXAM-XXXXXXX`

or enter the exam ID manually on the student page.

## Email Trigger

Create a time-driven Apps Script trigger for `checkAndSendEmails`.

Recommended:

- every 1 minute
- or every 5 minutes
