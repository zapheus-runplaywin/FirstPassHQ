import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useClub } from '@/lib/club';
import { clubToday } from '@/lib/club-time';
import { reportPdf, type Report } from '@/lib/pdf';
import { fileSlug, sharePdf } from '@/lib/reports';

/**
 * A report on screen, with a button that saves the same report as a PDF. Each
 * table row shows as a card: its first column in bold, then the others.
 */
export function ReportView({
  report,
  action,
}: {
  report: Report;
  /** Replaces the Export PDF button, such as Send return. Runs after the PDF is shared. */
  action?: { title: string; note: string; disabled?: boolean; onShared: () => Promise<void> | void };
}) {
  const club = useClub();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportPdf() {
    setExporting(true);
    setError(null);
    try {
      const bytes = reportPdf(report, { clubName: club.name, accent: club.colors.accent });
      await sharePdf(
        `${fileSlug(club.shortName)}-${fileSlug(report.title)}-${clubToday()}.pdf`,
        bytes,
      );
      await action?.onShared();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The PDF didn’t save. Try again.');
    } finally {
      setExporting(false);
    }
  }

  return (
    <View style={styles.report}>
      {report.subtitle ? (
        <ThemedText type="small" themeColor="textSecondary">
          {report.subtitle}
        </ThemedText>
      ) : null}

      {report.stats?.length ? (
        <View style={styles.stats}>
          {report.stats.map((stat) => (
            <Card key={stat.label} style={styles.stat}>
              <ThemedText type="subtitle">{stat.value}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {stat.label}
              </ThemedText>
            </Card>
          ))}
        </View>
      ) : null}

      <Button
        title={action?.title ?? 'Export PDF'}
        onPress={exportPdf}
        busy={exporting}
        disabled={action?.disabled}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {action?.note ??
          'Opens the share sheet, so you can save it to OneDrive or attach it to an email.'}
      </ThemedText>
      <ErrorText>{error}</ErrorText>

      {report.sections.map((section, s) => (
        <View key={`${section.title}-${s}`} style={styles.section}>
          <ThemedText type="smallBold">{section.title}</ThemedText>
          {section.note ? (
            <ThemedText type="small" themeColor="textSecondary">
              {section.note}
            </ThemedText>
          ) : null}
          {section.rows.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {section.empty ?? 'Nothing to show.'}
            </ThemedText>
          ) : (
            section.rows.map((row, r) => (
              <Card key={r}>
                <ThemedText type="smallBold" themeColor={row.flag ? 'tint' : undefined}>
                  {row.cells[0]}
                </ThemedText>
                {section.columns.slice(1).map((column, c) => {
                  const value = row.cells[c + 1];
                  if (!value) return null;
                  return (
                    <ThemedText key={column.label} type="small" themeColor="textSecondary">
                      {column.label}: {value.replace(/\n/g, ', ')}
                    </ThemedText>
                  );
                })}
              </Card>
            ))
          )}
        </View>
      ))}

      {report.footnote ? (
        <ThemedText type="small" themeColor="textSecondary">
          {report.footnote}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  report: {
    gap: Spacing.three,
  },
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  stat: {
    flexGrow: 1,
    flexBasis: '30%',
    alignItems: 'center',
  },
  section: {
    gap: Spacing.two,
  },
});
