import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { formatDateString } from '@/lib/injuries';
import type { Report, ReportSection } from '@/lib/pdf';
import {
  answerText,
  closingDay,
  identityLabels,
  openingDay,
  surveyAudienceLabel,
  type SurveyAnswer,
  type SurveyQuestion,
  type SurveyResults,
  type SurveySummary,
} from '@/lib/surveys';
import type { Sheet } from '@/lib/xlsx';

/** Every set of answers, from `survey_export`. */
export type SurveyExport = {
  survey: SurveySummary;
  sent_to: number;
  answered: number;
  questions: Omit<SurveyQuestion, 'required'>[];
  /** Named ones carry the name and time; anonymous and unnamed ones neither. */
  responses: { name: string | null; submitted_at: string | null; answers: SurveyAnswer[] }[];
  waiting: string[];
};

function percent(count: number, total: number) {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : '0%';
}

function surveyLine(survey: SurveySummary) {
  return [
    identityLabels[survey.identity],
    `To ${surveyAudienceLabel(survey.audience, survey.audience_role, survey.audience_label)}`,
    survey.created_by_name ? `From ${survey.created_by_name}` : null,
    survey.everyone_answers ? 'Everyone must answer' : null,
    `${formatDateString(openingDay(survey.opens_at))} to ${formatDateString(closingDay(survey.closes_at))}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A PDF summary of a survey's results: counts, averages and written answers. */
export function surveyReport(results: SurveyResults): Report {
  const { survey } = results;
  const sections: ReportSection[] = results.questions.map((q, i) => {
    const title = `${i + 1}. ${q.prompt}`;
    if (q.kind === 'text') {
      return {
        title,
        note: `${q.answered} written ${q.answered === 1 ? 'answer' : 'answers'}${
          survey.identity === 'named' ? '' : ', in alphabetical order'
        }`,
        columns: survey.identity === 'anonymous' ? [{ label: 'Answer' }] : [{ label: 'Answer', width: 3 }, { label: 'Name' }],
        rows: (q.texts ?? []).map((t) => ({
          cells: survey.identity === 'anonymous' ? [t.text] : [t.text, t.name ?? 'Not given'],
        })),
        empty: 'Nobody wrote an answer.',
      };
    }
    const labels =
      q.kind === 'rating'
        ? Array.from({ length: q.rating_max ?? 0 }, (_, n) => String(n + 1))
        : (q.options ?? []);
    return {
      title,
      note: [
        `${q.answered} answered`,
        q.kind === 'multi_choice' ? 'each could pick several' : null,
        q.kind === 'rating' && q.average !== null ? `average ${q.average} out of ${q.rating_max}` : null,
      ]
        .filter(Boolean)
        .join(', '),
      columns: [{ label: q.kind === 'rating' ? 'Rating' : 'Choice', width: 3 }, { label: 'Answers' }, { label: 'Share' }],
      rows: labels.map((label, n) => {
        const count = q.counts?.[n] ?? 0;
        return { cells: [label, String(count), percent(count, q.answered)] };
      }),
    };
  });
  if (results.waiting.length > 0) {
    sections.push({
      title: 'Not answered yet',
      columns: [{ label: 'Name' }],
      rows: results.waiting.map((name) => ({ cells: [name] })),
    });
  }
  return {
    title: survey.title,
    subtitle: surveyLine(survey),
    stats: [
      { label: 'Sent to', value: results.sent_to },
      { label: 'Answered', value: results.answered },
      { label: 'Response rate', value: percent(results.answered, results.sent_to) },
    ],
    sections,
    footnote:
      survey.identity === 'anonymous'
        ? 'Anonymous survey: answers are kept with no name, member or time, so nobody can see who gave them.'
        : survey.identity === 'optional'
          ? 'Name optional: names show only where the member chose to give theirs.'
          : 'Named survey: parents and guardians of athletes under 18 can read their child’s answers in the app.',
  };
}

/**
 * A spreadsheet of every answer: a Summary tab, an All answers tab with one
 * row per set of answers, and a tab for each question.
 */
export function surveyWorkbook(data: SurveyExport): Sheet[] {
  const { survey, questions, responses } = data;
  const named = responses.some((r) => r.name);
  const who = (r: SurveyExport['responses'][number]) => (named ? [r.name ?? 'Not given'] : []);
  const when = (r: SurveyExport['responses'][number]) =>
    survey.identity === 'named' ? [r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-AU') : ''] : [];
  const cell = (q: SurveyExport['questions'][number], a: SurveyAnswer | undefined) => {
    if (!a) return null;
    if (q.kind === 'rating') return a.rating;
    return answerText(q, a);
  };

  const summary: Sheet = {
    name: 'Summary',
    widths: [44, 14, 10],
    rows: [
      [survey.title, null, null],
      [surveyLine(survey), null, null],
      ['Sent to', data.sent_to, null],
      ['Answered', data.answered, null],
      [null, null, null],
      ...questions.flatMap((q, i): (string | number | null)[][] => {
        const answers = responses.map((r) => r.answers.find((a) => a.question_id === q.id)).filter(Boolean) as SurveyAnswer[];
        const heading: (string | number | null)[] = [`${i + 1}. ${q.prompt}`, 'Answers', 'Share'];
        if (q.kind === 'text') return [heading, ['Written answers', answers.length, null], [null, null, null]];
        const labels =
          q.kind === 'rating'
            ? Array.from({ length: q.rating_max ?? 0 }, (_, n) => String(n + 1))
            : (q.options ?? []);
        const rows = labels.map((label, n): (string | number | null)[] => {
          const count = answers.filter((a) =>
            q.kind === 'rating' ? a.rating === n + 1 : (a.choices ?? []).includes(n),
          ).length;
          return [label, count, percent(count, answers.length)];
        });
        const ratings = answers.map((a) => a.rating ?? 0).filter(Boolean);
        if (q.kind === 'rating' && ratings.length > 0) {
          rows.push(['Average', Math.round((ratings.reduce((x, y) => x + y, 0) / ratings.length) * 10) / 10, null]);
        }
        return [heading, ...rows, [null, null, null]];
      }),
    ],
  };

  const all: Sheet = {
    name: 'All answers',
    widths: [...(named ? [22] : []), ...(survey.identity === 'named' ? [20] : []), ...questions.map(() => 28)],
    rows: [
      [
        ...(named ? ['Name'] : []),
        ...(survey.identity === 'named' ? ['Answered'] : []),
        ...questions.map((q, i) => `${i + 1}. ${q.prompt}`),
      ],
      ...responses.map((r) => [
        ...who(r),
        ...when(r),
        ...questions.map((q) => cell(q, r.answers.find((a) => a.question_id === q.id))),
      ]),
    ],
  };

  const perQuestion = questions.map(
    (q, i): Sheet => ({
      name: `Q${i + 1} ${q.prompt}`,
      widths: [...(named ? [22] : []), 50],
      rows: [
        [...(named ? ['Name'] : []), `${i + 1}. ${q.prompt}`],
        ...responses
          .map((r) => ({ r, a: r.answers.find((x) => x.question_id === q.id) }))
          .filter(({ a }) => !!a)
          // Anonymous written answers in alphabetical order, as in the app.
          .sort((x, y) =>
            named ? 0 : String(cell(q, x.a) ?? '').localeCompare(String(cell(q, y.a) ?? '')),
          )
          .map(({ r, a }) => [...who(r), cell(q, a)]),
      ],
    }),
  );

  const sheets = [summary, all, ...perQuestion];
  if (data.waiting.length > 0) {
    sheets.push({ name: 'Not answered yet', widths: [30], rows: [['Name'], ...data.waiting.map((n) => [n])] });
  }
  return sheets;
}

/** Opens the share sheet for an Excel file. On the web it downloads instead. */
export async function shareXlsx(fileName: string, bytes: Uint8Array) {
  const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, fileName);
  file.write(bytes);
  await Sharing.shareAsync(file.uri, {
    mimeType,
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
    dialogTitle: fileName,
  });
}
