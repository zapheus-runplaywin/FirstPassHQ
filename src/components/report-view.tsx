import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { StatusLine } from '@/components/status-line';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ErrorText, PressableCard } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useClub } from '@/lib/club';
import { clubToday } from '@/lib/club-time';
import { foldedLine, reportPdf, type Report } from '@/lib/pdf';
import { fileSlug, sharePdf } from '@/lib/reports';

/**
 * A report on screen, with a button that saves the same report as a PDF. Each
 * table row shows as a card: its first column in bold, then the others.
 */
export function ReportView({
  report,
  action,
  buttonOnly = false,
  folded = false,
}: {
  report: Report;
  /** Shows only the PDF button, for a screen that lays the same facts out its own way. */
  buttonOnly?: boolean;
  /**
   * For a report with many sections: each section shows as one line (its title, how many
   * rows, how many are flagged) and opens when tapped, one at a time. The PDF is unchanged.
   */
  folded?: boolean;
  /** Replaces the Export PDF button, such as Send return. Runs after the PDF is shared. */
  action?: { title: string; note: string; disabled?: boolean; onShared: () => Promise<void> | void };
}) {
  const club = useClub();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

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
      {report.subtitle && !buttonOnly ? (
        <ThemedText type="small" themeColor="textSecondary">
          {report.subtitle}
        </ThemedText>
      ) : null}

      {report.stats?.length && !buttonOnly ? (
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

      {(buttonOnly ? [] : report.sections).map((section, s) => {
        if (folded && open !== s) {
          return (
            <PressableCard key={`${section.title}-${s}`} onPress={() => setOpen(s)}>
              <ThemedText type="smallBold">{section.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {foldedLine(section)}
              </ThemedText>
            </PressableCard>
          );
        }
        return (
          <View key={`${section.title}-${s}`} style={styles.section}>
            {folded ? (
              <PressableCard onPress={() => setOpen(null)}>
                <ThemedText type="smallBold">{section.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Tap to close
                </ThemedText>
              </PressableCard>
            ) : (
              <ThemedText type="smallBold">{section.title}</ThemedText>
            )}
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
                  {row.flag ? (
                    // A row that needs a look, such as a check that has run out.
                    <StatusLine text={row.cells[0]} tone="attention" />
                  ) : (
                    <ThemedText type="smallBold">{row.cells[0]}</ThemedText>
                  )}
                  {section.columns.slice(1).map((column, c) => {
                    const value = row.cells[c + 1];
                    if (!value) return null;
                    return (
                      <ThemedText key={column.label} type="small" themeColor="textSecondary">
                        {column.label ? `${column.label}: ` : ''}
                        {value.replace(/\n/g, ', ')}
                      </ThemedText>
                    );
                  })}
                </Card>
              ))
            )}
          </View>
        );
      })}

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
