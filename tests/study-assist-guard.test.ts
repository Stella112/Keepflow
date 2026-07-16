import { describe, expect, it } from 'vitest';
import {
  STUDY_ASSIST_PERSON_NAME_LIMITATION,
  classifyStudyAssistAcademicIntegrity,
  detectStudyAssistAcademicMisuse,
  maskStudyAssistPersonalData,
  scanStudyAssistSecrets,
  type StudyAssistRequestedAction,
} from '../src/security/study-assist-guard.js';

describe('Study Assist academic-integrity guard', () => {
  it.each([
    'learn_concepts',
    'summarize_material',
    'generate_practice',
    'draft_with_citation_guidance',
  ] satisfies StudyAssistRequestedAction[])(
    'allows bounded learning support for %s but never submission generation',
    (requestedAction) => {
      const decision = classifyStudyAssistAcademicIntegrity(requestedAction);
      expect(decision).toMatchObject({
        requested_action: requestedAction,
        status: 'compliant',
        learning_support_allowed: true,
        model_contact_allowed: true,
        submission_generation_allowed: false,
        reason_code: 'learning_support_only',
      });
    },
  );

  it('limits citation-guided drafting to coaching and learner-written work', () => {
    const decision = classifyStudyAssistAcademicIntegrity('draft_with_citation_guidance');
    expect(decision.safe_alternative).toMatch(/outline|citation|feedback/i);
    expect(decision.safe_alternative).toMatch(/learner writes/i);
    expect(decision.submission_generation_allowed).toBe(false);
  });

  it.each([
    ['produce_submission', 'submission_production_blocked'],
    ['take_live_assessment', 'live_assessment_blocked'],
    ['impersonate_learner', 'learner_impersonation_blocked'],
  ] as const)('redirects %s before model contact', (requestedAction, reasonCode) => {
    const decision = classifyStudyAssistAcademicIntegrity(requestedAction);
    expect(decision).toMatchObject({
      status: 'redirected',
      learning_support_allowed: false,
      model_contact_allowed: false,
      submission_generation_allowed: false,
      reason_code: reasonCode,
    });
    expect(decision.safe_alternative.length).toBeGreaterThan(20);
  });

  it('fails closed for an action not recognized by the current input schema', () => {
    expect(classifyStudyAssistAcademicIntegrity('complete_hidden_exam')).toMatchObject({
      status: 'redirected',
      model_contact_allowed: false,
      submission_generation_allowed: false,
      reason_code: 'unsupported_action_blocked',
    });
  });

  it.each([
    ['Write my graded assignment for me', 'produce_submission'],
    ['Give me all the answers', 'produce_submission'],
    ['帮我写这个课程作业', 'produce_submission'],
    ['Haz mi tarea', 'produce_submission'],
    ['Take my proctored exam for me', 'take_live_assessment'],
    ['替我考试', 'take_live_assessment'],
    ['Log in as me and submit it', 'impersonate_learner'],
    ['替我登录并提交', 'impersonate_learner'],
  ] as const)('detects concealed academic misuse: %s', (text, expected) => {
    expect(detectStudyAssistAcademicMisuse([text])).toBe(expected);
  });

  it('does not confuse ordinary exam preparation with live-assessment help', () => {
    expect(detectStudyAssistAcademicMisuse([
      'Explain this topic so I can prepare for my biology exam.',
    ])).toBeNull();
  });
});

describe('Study Assist secret-category scan', () => {
  it('scans every model-bound field and returns category names without secret values', () => {
    const apiKey = 'live_customer_service_token_123456789';
    const bearer = 'abcdefghijklmnopqrstuvwxyz.123456789';
    const password = 'hunter2xyz';
    const connection = 'postgres://alice:supersecret@db.example/study';
    const privateKey = `0x${'a'.repeat(64)}`;
    const seed =
      'legal winner thank year wave sausage worth useful legal winner thank yellow';

    const result = scanStudyAssistSecrets({
      title: `api_key=${apiKey}`,
      question: `Authorization: Bearer ${bearer}`,
      topic: `password: ${password}`,
      query: connection,
      extracted_chunks: [
        `Private key: ${privateKey}`,
        `My recovery phrase is ${seed}`,
        'The OTP code is 123456',
      ],
    });

    expect(result.detected).toBe(true);
    expect(result.categories).toEqual([
      'mnemonic',
      'privateKeyHex',
      'otpCode',
      'password',
      'apiToken',
      'bearerToken',
      'connectionString',
    ]);

    const serialized = JSON.stringify(result);
    for (const secret of [apiKey, bearer, password, connection, privateKey, seed, '123456']) {
      expect(serialized).not.toContain(secret);
    }
    expect(Object.keys(result)).toEqual(['detected', 'categories']);
  });

  it('finds credentials in later extracted chunks without returning chunk text', () => {
    const token = `sk-${'b'.repeat(32)}`;
    const result = scanStudyAssistSecrets({
      extracted_chunks: ['Ordinary first page.', `Second page token ${token}`],
    });
    expect(result).toEqual({ detected: true, categories: ['apiToken'] });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain('Second page');
  });

  it('returns a minimal negative result for ordinary multilingual study text', () => {
    const result = scanStudyAssistSecrets({
      title: '细胞分裂课程笔记',
      topic: 'La photosynthèse et la respiration',
      question: 'اشرح الفكرة باستخدام الملاحظات فقط',
      query: 'evidence-based teaching methods',
      extracted_chunks: ['The year 2026 appears in the source and chapter 12 has 42 exercises.'],
    });
    expect(result).toEqual({ detected: false, categories: [] });
  });

  it('deduplicates categories detected in multiple fields', () => {
    const result = scanStudyAssistSecrets({
      title: 'password: firstSecretValue',
      question: 'password: secondSecretValue',
    });
    expect(result).toEqual({ detected: true, categories: ['password'] });
  });
});

describe('offset-preserving Study Assist personal-data mask', () => {
  it('masks direct ASCII and Unicode email addresses at the same length', () => {
    const input = 'Contact ada.student@example.edu or 学生@大学.cn for the reading list.';
    const result = maskStudyAssistPersonalData(input);

    expect(result.categories).toEqual(['email']);
    expect(result.masked_text.length).toBe(input.length);
    expect(result.masked_text).not.toContain('ada.student@example.edu');
    expect(result.masked_text).not.toContain('学生@大学.cn');
    expect(result.masked_text).toContain('Contact ');
    expect(result.masked_text).toContain(' for the reading list.');
  });

  it.each([
    'Phone: +1 (202) 555-0147',
    'mobile no. 0803 123 4567',
    'TEL # 020 7946 0958',
    'telephone number=+86 138 0013 8000',
  ])('masks a labelled phone variant without shifting offsets: %s', (input) => {
    const result = maskStudyAssistPersonalData(input);
    expect(result.categories).toEqual(['phone']);
    expect(result.masked_text.length).toBe(input.length);
    expect(result.masked_text).not.toMatch(/\d{4,}/);
    for (let index = 0; index < input.length; index++) {
      if (/\s/u.test(input[index]!)) expect(result.masked_text[index]).toBe(input[index]);
    }
  });

  it.each([
    'Student ID: UNI-2026-0042',
    'student_number = 2024/SCI/991',
    'Learner-ID: AB.55219',
    'Matric no. 19-ENG-884',
    'matriculation number is PG/2026/117',
  ])('masks a labelled student identifier without masking its label: %s', (input) => {
    const result = maskStudyAssistPersonalData(input);
    expect(result.categories).toEqual(['student_id']);
    expect(result.masked_text.length).toBe(input.length);
    expect(result.masked_text.slice(0, input.search(/[:=]|\sis\s|\s\d|\s[A-Z]{2}/i)))
      .toBe(input.slice(0, input.search(/[:=]|\sis\s|\s\d|\s[A-Z]{2}/i)));
  });

  it('recognizes reasonable zero-width label variants while preserving the label bytes', () => {
    const phoneLabel = 'p\u200Bh\u200Bo\u200Bn\u200Be';
    const studentLabel = 'student\u200B-\u200Bid';
    const input = `${phoneLabel}: 0812 345 6789\n${studentLabel}: ZX-00192`;
    const result = maskStudyAssistPersonalData(input);

    expect(result.categories).toEqual(['phone', 'student_id']);
    expect(result.masked_text.length).toBe(input.length);
    expect(result.masked_text.startsWith(phoneLabel)).toBe(true);
    expect(result.masked_text).toContain(`\n${studentLabel}: `);
    expect(result.masked_text).not.toContain('0812');
    expect(result.masked_text).not.toContain('ZX-00192');
  });

  it('preserves multilingual content, emoji, newlines, and whitespace outside values', () => {
    const input =
      '课程说明 📘\nTéléphone : +33 1 42 68 53 00\nالبريد: learner@example.org\n終わり';
    const result = maskStudyAssistPersonalData(input);

    expect(result.masked_text.length).toBe(input.length);
    expect(result.masked_text).toContain('课程说明 📘\nTéléphone : ');
    expect(result.masked_text).toContain('\nالبريد: ');
    expect(result.masked_text.endsWith('\n終わり')).toBe(true);
    expect(result.masked_text.split('\n')).toHaveLength(input.split('\n').length);
    expect(result.categories).toEqual(['email', 'phone']);
  });

  it('does not mask unlabelled ordinary numbers, dates, page ranges, or ISBNs', () => {
    const input =
      'In 2026, read pages 120-135. The smartphone 1234567 study used a nonstudent id 88442 and ISBN 978-1-4028-9462-6.';
    const result = maskStudyAssistPersonalData(input);
    expect(result.masked_text).toBe(input);
    expect(result.categories).toEqual([]);
  });

  it('does not mask short or implausibly long phone-like values even with a label', () => {
    const input = 'Phone: 12345; mobile: 12345678901234567';
    const result = maskStudyAssistPersonalData(input);
    expect(result.masked_text).toBe(input);
    expect(result.categories).toEqual([]);
  });

  it('does not attempt person-name detection and exposes that limitation', () => {
    const input = 'Student name: Ada Lovelace\nTutor: 李华';
    const result = maskStudyAssistPersonalData(input);
    expect(result.masked_text).toBe(input);
    expect(result.categories).toEqual([]);
    expect(result.person_name_detection_performed).toBe(false);
    expect(result.limitation).toBe(STUDY_ASSIST_PERSON_NAME_LIMITATION);
    expect(result.limitation).toMatch(/names are not detected/i);
  });

  it('preserves UTF-16 offsets when an email contains a supplementary-plane letter', () => {
    const input = 'Email: 𐐀.student@example.org\nNext section starts here.';
    const nextSectionOffset = input.indexOf('Next section');
    const result = maskStudyAssistPersonalData(input);
    expect(result.masked_text.length).toBe(input.length);
    expect(result.masked_text.indexOf('Next section')).toBe(nextSectionOffset);
    expect(result.masked_text).not.toContain('𐐀.student@example.org');
  });
});
