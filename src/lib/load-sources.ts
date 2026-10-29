/**
 * The published sources behind each training load flag and chart, shown as
 * "Why this flag" (Matt, 28 October 2026: every flag coaches and parents see
 * names the real paper or website it rests on). Each was checked against the
 * paper's own abstract or the publisher's page, not written from memory;
 * links are DOIs where the paper has one. Change one only after reading the
 * source again.
 */
export type LoadSource = {
  key: SourceKey;
  /** Such as "Gabbett 2016". */
  short: string;
  title: string;
  where: string;
  url: string;
  /** What the source found, in a sentence, as the app uses it. */
  finding: string;
};

export type SourceKey =
  | 'gabbett2016'
  | 'jayanthi2015'
  | 'saw2016'
  | 'foster1998'
  | 'foster2001'
  | 'coggan'
  | 'impellizzeri2020';

export const LOAD_SOURCES: Record<SourceKey, LoadSource> = {
  gabbett2016: {
    key: 'gabbett2016',
    short: 'Gabbett 2016',
    title: 'The training-injury prevention paradox: should athletes be training smarter and harder?',
    where: 'British Journal of Sports Medicine, 2016',
    url: 'https://doi.org/10.1136/bjsports-2015-095788',
    finding:
      'In adult professional cricket, Australian football and rugby league players, rapid rises in load, more than steady high load, went with soft-tissue injuries. With the last week’s load against a rolling average of the last 3 to 6 weeks, about 0.8 to 1.3 was called the “sweet spot” and 1.5 or more the “danger zone”. The paper notes different sports may differ, and nothing in it is about juniors or netball, so the app uses 1.5 only as a prompt to talk.',
  },
  jayanthi2015: {
    key: 'jayanthi2015',
    short: 'Jayanthi et al. 2015',
    title: 'Sports-specialized intensive training and the risk of injury in young athletes',
    where: 'American Journal of Sports Medicine, 2015',
    url: 'https://doi.org/10.1177/0363546514567298',
    finding:
      'In a clinic-based case-control study of 1,190 athletes aged 7 to 18, those who played more hours of organised sport in a typical week than their age in years had about twice the odds of a serious overuse injury. The app adds up any one 7 days, gym and other sport included, so a single busy week can prompt a chat.',
  },
  saw2016: {
    key: 'saw2016',
    short: 'Saw et al. 2016',
    title:
      'Monitoring the athlete training response: subjective self-reported measures trump commonly used objective measures',
    where: 'British Journal of Sports Medicine, 2016',
    url: 'https://doi.org/10.1136/bjsports-2015-094758',
    finding:
      'How athletes said they felt tracked changes in their training load better than commonly used objective measures, so check-ins and load are read together. The paper sets no threshold: 2 or more low check-ins in 7 days is the club’s own line.',
  },
  foster1998: {
    key: 'foster1998',
    short: 'Foster 1998',
    title: 'Monitoring training in athletes with reference to overtraining syndrome',
    where: 'Medicine & Science in Sports & Exercise, 1998',
    url: 'https://doi.org/10.1097/00005768-199807000-00023',
    finding:
      'Monotony (a week’s average daily load divided by how much it varied) and strain (load times monotony). Most illnesses came when athletes passed their own strain levels. There’s no single cut-off, so the app shows these without flagging them.',
  },
  foster2001: {
    key: 'foster2001',
    short: 'Foster et al. 2001',
    title: 'A new approach to monitoring exercise training',
    where: 'Journal of Strength and Conditioning Research, 2001',
    url: 'https://doi.org/10.1519/1533-4287(2001)015%3C0109:ANATME%3E2.0.CO;2',
    finding:
      'Minutes times how hard a session felt (1 to 10, asked about 30 minutes after) measures training load across many kinds of sessions.',
  },
  coggan: {
    key: 'coggan',
    short: 'TrainingPeaks',
    title: 'The science of the TrainingPeaks Performance Manager (Andrew Coggan)',
    where: 'TrainingPeaks',
    url: 'https://www.trainingpeaks.com/learn/articles/the-science-of-the-performance-manager/',
    finding:
      'Fitness is a 42-day weighted average of daily load, fatigue a 7-day one, and form is fitness minus fatigue, after Banister’s 1975 model.',
  },
  impellizzeri2020: {
    key: 'impellizzeri2020',
    short: 'Impellizzeri et al. 2020',
    title: 'Acute:Chronic Workload Ratio: Conceptual Issues and Fundamental Pitfalls',
    where: 'International Journal of Sports Physiology and Performance, 2020',
    url: 'https://doi.org/10.1123/ijspp.2019-0864',
    finding:
      'No study has shown that changing this ratio changes injury rates, and the authors call it an inaccurate and ambiguous measure for deciding training, so it’s a reason to talk, not a prediction or a cut-off.',
  },
};
