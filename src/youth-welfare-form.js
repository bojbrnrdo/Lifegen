import { httpError } from './domain.js';

export const YOUTH_WELFARE_CONSENT_TEXT = 'I agree that LCF LifeGen - Central Youth Welfare may collect and use my answers for youth welfare and follow-up purposes.';
export const YOUTH_WELFARE_CONSENT_VERSION = 'lcf-central-youth-welfare-2026-11-02';

export const YOUTH_EDUCATION_STATUSES = Object.freeze({
  currently_studying: 'Currently studying',
  out_of_school: 'Out-of-school youth/stopped schooling',
  currently_als: 'Currently in ALS',
  working_student: 'Working Student',
  graduated: 'Graduated',
});
export const YOUTH_GRADE_YEAR_LEVELS = Object.freeze({
  elementary_grade_6: 'Elementary - Grade 6',
  junior_high_grade_7: 'Junior High School - Grade 7',
  junior_high_grade_8: 'Junior High School - Grade 8',
  junior_high_grade_9: 'Junior High School - Grade 9',
  junior_high_grade_10: 'Junior High School - Grade 10',
  senior_high_grade_11: 'Senior High School - Grade 11',
  senior_high_grade_12: 'Senior High School - Grade 12',
  college_first_year: 'First Year College',
  college_second_year: 'Second Year College',
  college_third_year: 'Third Year College',
  college_fourth_year: 'Fourth Year College',
  als_junior_high: 'ALS - Junior High',
  als_senior_high: 'ALS - Senior High',
  tesda_vocational: 'TESDA/Vocational',
});
export const YOUTH_SCHOOL_STOP_PERIODS = Object.freeze({
  current_ay_2026_2027: 'This school year (A.Y. 2026-2027)',
  last_school_year: 'Last school year',
  two_years_ago: '2 years ago',
  three_or_more_years_ago: '3 or more years ago',
  unsure: "I'm not sure / I can't remember",
});
export const YOUTH_SCHOOL_STOP_REASONS = Object.freeze({
  financial_problem: 'Financial problem',
  needed_to_work: 'Needed to work',
  family_problem: 'Family problem',
  personal_reason: 'Personal reason',
  academic_struggle: 'Academic struggle',
  health_problem: 'Health problem',
  missing_school_requirements: 'Missing school requirements/documents',
  prefer_not_to_say: 'Prefer not to say',
});
export const YOUTH_CONTINUATION_CHOICES = Object.freeze({
  yes_definitely: 'Yes, definitely',
  yes_need_help: 'Yes, but I need help',
  maybe: 'Maybe',
  not_right_now: 'Not right now',
  no: "No, I don't want to.",
});
export const YOUTH_LCSOL_STATUSES = Object.freeze({
  not_yet_started: 'Not yet started',
  currently_in_consolidation: 'Currently in Consolidation',
  done_in_consolidation: 'Done in Consolidation',
  done_in_pre_encounter: 'Done Pre-Encounter',
  done_encounter: 'Done Encounter',
  done_post_encounter: 'Done Post-Encounter',
  currently_in_undercover: 'Currently in Undercover',
  done_in_undercover: 'Done in Undercover',
  sol_1: 'SOL 1',
  sol_2: 'SOL 2',
  sol_3: 'SOL 3',
  graduate_completed: 'Graduate / Completed',
});

const GRADE_STATUSES = new Set(['currently_studying', 'currently_als', 'working_student']);
const asObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const optionalChoice = (raw, choices, label) => {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (!Object.hasOwn(choices, value)) throw httpError(400, `Choose a valid ${label}.`);
  return value;
};
function requiredString(raw, max, label) {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (value.length < 2) throw httpError(400, `Enter ${label}.`);
  if (value.length > max) throw httpError(400, `${label} must be ${max} characters or fewer.`);
  return value;
}
function requiredPhone(raw, label) {
  const value = String(raw ?? '').trim();
  const digits = value.replace(/\D/g, '');
  if (value.length < 7 || value.length > 40 || digits.length < 7) throw httpError(400, `Enter a valid ${label}.`);
  return value;
}
function validOptionalIsoDate(raw, label) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw httpError(400, `Enter a valid ${label}.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw httpError(400, `Enter a valid ${label}.`);
  return value;
}

/**
 * Validate and normalize Youth Welfare answers submitted through the existing
 * regular-attendee form. Birthday, name, sex, school and selected leader remain
 * canonical LIFEGEN registration fields and are intentionally not duplicated.
 */
export function normalizeYouthWelfareAnswers(raw) {
  const body = asObject(raw);
  if (body.consent !== true) throw httpError(400, 'Please read and agree to the Youth Welfare consent statement.');
  const educationStatus = optionalChoice(body.education_status, YOUTH_EDUCATION_STATUSES, 'education status');
  if (!educationStatus) throw httpError(400, 'Choose your educational status.');
  const applicableGrade = GRADE_STATUSES.has(educationStatus);
  const gradeYearLevel = applicableGrade
    ? optionalChoice(body.grade_year_level, YOUTH_GRADE_YEAR_LEVELS, 'grade/year level')
    : null;
  if (applicableGrade && !gradeYearLevel) throw httpError(400, 'Choose your grade/year level.');

  const outOfSchool = educationStatus === 'out_of_school';
  const schoolStopPeriod = outOfSchool ? optionalChoice(body.school_stop_period, YOUTH_SCHOOL_STOP_PERIODS, 'school-stop period') : null;
  const continueStudies = outOfSchool ? optionalChoice(body.continue_studies, YOUTH_CONTINUATION_CHOICES, 'continuation answer') : null;
  let schoolStopReasons = [];
  if (outOfSchool && body.school_stop_reasons != null && body.school_stop_reasons !== '') {
    if (!Array.isArray(body.school_stop_reasons)) throw httpError(400, 'Select one or more school-stop reasons.');
    schoolStopReasons = [...new Set(body.school_stop_reasons.map(value => String(value ?? '').trim()).filter(Boolean))];
    if (schoolStopReasons.some(value => !Object.hasOwn(YOUTH_SCHOOL_STOP_REASONS, value))) throw httpError(400, 'Choose valid school-stop reasons.');
  }

  const lcsolEnrolled = body.lcsol_enrolled;
  if (typeof lcsolEnrolled !== 'boolean') throw httpError(400, 'Choose Yes or No for LCSOL enrollment.');
  const lcsolStatus = optionalChoice(body.lcsol_status, YOUTH_LCSOL_STATUSES, 'LCSOL status');
  if (!lcsolStatus) throw httpError(400, 'Choose your current LCSOL status.');
  if (!lcsolEnrolled && lcsolStatus !== 'not_yet_started') {
    throw httpError(400, 'LCSOL enrollment is No, so choose “Not yet started” or correct the enrollment answer.');
  }
  if (lcsolEnrolled && lcsolStatus === 'not_yet_started') {
    throw httpError(400, 'LCSOL enrollment is Yes, so choose a status other than “Not yet started” or correct the enrollment answer.');
  }

  return {
    messenger_facebook_name: String(body.messenger_facebook_name ?? '').trim().slice(0, 200) || null,
    complete_address: requiredString(body.complete_address, 500, 'your complete address'),
    contact_number: requiredPhone(body.contact_number, 'contact number'),
    parent_guardian_name: requiredString(body.parent_guardian_name, 200, 'your parent/guardian name'),
    parent_guardian_contact: requiredPhone(body.parent_guardian_contact_number, 'your parent/guardian contact number'),
    education_status: educationStatus,
    grade_year_level: gradeYearLevel,
    school_stop_period: schoolStopPeriod,
    school_stop_reasons: schoolStopReasons,
    continue_studies: continueStudies,
    church_invited_at: validOptionalIsoDate(body.church_invited_at, 'church invitation date'),
    lcsol_enrolled: lcsolEnrolled,
    lcsol_status: lcsolStatus,
  };
}
