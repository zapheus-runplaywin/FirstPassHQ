import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { SurveyBars } from '@/components/survey-bars';
import { Button, Card, ConfirmDelete, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useClub } from '@/lib/club';
import { toDateString } from '@/lib/injuries';
import { reportPdf } from '@/lib/pdf';
import { fileSlug, sharePdf } from '@/lib/reports';
import { shareXlsx, surveyReport, surveyWorkbook, type SurveyExport } from '@/lib/survey-reports';
import { supabase } from '@/lib/supabase';
import { answeredText, answerText, surveyWaitText, type SurveyResults } from '@/lib/surveys';
import { workbookXlsx } from '@/lib/xlsx';

export default function SurveyResultsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [results, setResults] = useState<SurveyResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const club = useClub();
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: fetchError } = await supabase.rpc('survey_results', { p_survey_id: id });
    if (fetchError) setError(fetchError.message);
    else setResults(data as SurveyResults);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (error) {
    return (
      <Screen>
        <ErrorText>{error}</ErrorText>
      </Screen>
    );
  }
  if (!results) return <Screen>{null}</Screen>;

  const fileName = (ext: string) =>
    `${fileSlug(club.shortName)}-${fileSlug(results.survey.title)}-${toDateString(new Date())}.${ext}`;

  async function downloadPdf() {
    if (!results) return;
    setExporting('pdf');
    setExportError(null);
    try {
      const bytes = reportPdf(surveyReport(results), {
        clubName: club.name,
        accent: club.colors.accent,
      });
      await sharePdf(fileName('pdf'), bytes);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'The PDF didn’t save. Try again.');
    } finally {
      setExporting(null);
    }
  }

  // Accept the answers as they are, such as when not everyone will answer.
  async function closeNow() {
    setClosing(true);
    setCloseError(null);
    const { error: rpcError } = await supabase.rpc('set_survey_closing', {
      p_survey_id: id,
      p_closes_at: new Date().toISOString(),
    });
    setClosing(false);
    if (rpcError) return setCloseError(rpcError.message);
    load();
  }

  async function downloadSpreadsheet() {
    setExporting('xlsx');
    setExportError(null);
    try {
      const { data, error: fetchError } = await supabase.rpc('survey_export', { p_survey_id: id });
      if (fetchError) throw new Error(fetchError.message);
      await shareXlsx(fileName('xlsx'), workbookXlsx(surveyWorkbook(data as SurveyExport)));
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'The spreadsheet didn’t save. Try again.');
    } finally {
      setExporting(null);
    }
  }

  return (
    <Screen>
      <ThemedText type="smallBold">{answeredText(results.answered, results.sent_to)}</ThemedText>
      {results.survey.everyone_answers || results.survey.results_to_group ? (
        <ThemedText type="small" themeColor="textSecondary">
          {[
            results.survey.everyone_answers ? 'Everyone must answer.' : null,
            results.survey.results_to_group
              ? 'The squad or team sees how many picked each choice, never names or written answers.'
              : null,
          ]
            .filter(Boolean)
            .join(' ')}
        </ThemedText>
      ) : null}

      {results.hidden ? (
        <Card style={styles.question}>
          <ThemedText type="small">
            {results.wait ? surveyWaitText(results.wait, results.survey) : null}
          </ThemedText>
          {results.can_close ? (
            <ConfirmDelete
              title="Close now and see results"
              warning={
                results.survey.identity !== 'named' && results.answered < results.min_responses
                  ? `Nobody else can answer once it’s closed, and results still need at least ${results.min_responses} answers.`
                  : 'Nobody else can answer once it’s closed. Results show with the answers so far.'
              }
              confirmTitle="Close the survey"
              onConfirm={closeNow}
              busy={closing}
            />
          ) : null}
          <ErrorText>{closeError}</ErrorText>
        </Card>
      ) : (
        results.questions.map((q, i) => (
          <Card key={q.id} style={styles.question}>
            <ThemedText type="smallBold">
              {i + 1}. {q.prompt}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {q.answered} answered
              {q.kind === 'rating' && q.average !== null ? ` · Average ${q.average} out of ${q.rating_max}` : ''}
            </ThemedText>
            <SurveyBars question={q} />
            {q.texts?.map((t, n) => (
              <View key={n} style={styles.text}>
                <ThemedText type="small">{t.text}</ThemedText>
                {t.name ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t.name}
                  </ThemedText>
                ) : null}
              </View>
            ))}
          </Card>
        ))
      )}

      {!results.hidden && results.respondents.length > 0 ? (
        <>
          <ThemedText type="smallBold">Named answers</ThemedText>
          {results.respondents.map((r, n) => (
            <Card key={n}>
              <ThemedText type="smallBold">{r.name}</ThemedText>
              {results.questions.map((q) => {
                const a = r.answers.find((x) => x.question_id === q.id);
                return a ? (
                  <ThemedText key={q.id} type="small">
                    {q.prompt}: {answerText(q, a)}
                  </ThemedText>
                ) : null;
              })}
            </Card>
          ))}
        </>
      ) : null}

      {results.waiting.length > 0 ? (
        <>
          <ThemedText type="smallBold">Not answered yet</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {results.waiting.join(', ')}
          </ThemedText>
        </>
      ) : null}

      {!results.hidden && results.can_export ? (
        <View style={styles.actions}>
          <Button
            title="Download PDF summary"
            variant="secondary"
            onPress={downloadPdf}
            busy={exporting === 'pdf'}
          />
          <Button
            title="Download spreadsheet"
            variant="secondary"
            onPress={downloadSpreadsheet}
            busy={exporting === 'xlsx'}
          />
          <ThemedText type="small" themeColor="textSecondary">
            The spreadsheet is an Excel file with a summary, every set of answers, and a tab for
            each question.
            {results.survey.identity === 'anonymous'
              ? ' Anonymous answers have no names or times.'
              : ' Keep files with members’ names safe, and delete them when you’re done.'}
          </ThemedText>
          <ErrorText>{exportError}</ErrorText>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: Spacing.three,
  },
  question: {
    gap: Spacing.two,
  },
  text: {
    gap: Spacing.half,
    paddingTop: Spacing.one,
  },
});
