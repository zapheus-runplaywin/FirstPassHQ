import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';

import { PolicyLinks } from '@/components/policy-links';
import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, isMinor, isUnder13, parseDate, under13Message } from '@/lib/age';
import { looksLikeLinkCode } from '@/lib/guardian-links';
import { useAuth } from '@/lib/auth';
import { useSquads } from '@/lib/club';
import { isTeamRole, requestableRoles, roleLabels } from '@/lib/labels';
import { isHiddenAppleEmail, nameFromSignIn } from '@/lib/sign-in';
import { supabase } from '@/lib/supabase';
import { volunteerScreeningLabels } from '@/lib/safety';
import type { AppRole, VolunteerScreening } from '@/lib/types';
import { newestGroups, useTeams } from '@/lib/use-teams';

export default function JoinScreen() {
  const { session, profile, refresh } = useAuth();
  const groups = newestGroups(useTeams());
  const word = useSquads() ? 'squad' : 'team';
  // Apple gives a name only on the first sign-in, and the app saves it to the
  // sign-in's own details (signInWithApple), after the profile was made.
  const [fullName, setFullName] = useState(
    profile?.full_name || nameFromSignIn(session?.user.user_metadata) || '',
  );
  const [playhqEmail, setPlayhqEmail] = useState(profile?.playhq_email ?? '');
  const [role, setRole] = useState<AppRole | null>(profile?.requested_role ?? null);
  const [teamId, setTeamId] = useState<string | null>(profile?.requested_team_id ?? null);
  const [dateOfBirth, setDateOfBirth] = useState(formatDate(profile?.declared_date_of_birth));
  const [guardianEmail, setGuardianEmail] = useState(profile?.guardian_email ?? '');
  const [task, setTask] = useState(profile?.volunteer_task ?? '');
  const [from, setFrom] = useState(formatDate(profile?.volunteer_from));
  const [until, setUntil] = useState(formatDate(profile?.volunteer_until));
  const [screening, setScreening] = useState<VolunteerScreening | null>(
    profile?.volunteer_screening ?? null,
  );
  const [cardNumber, setCardNumber] = useState(profile?.declared_wwcc_number ?? '');
  const [childCode, setChildCode] = useState('');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Turned away for being under 13: the form stays, so a parent who typed
  // their child's date can correct it, and a child can delete the sign-in.
  const [tooYoung, setTooYoung] = useState(false);
  const theme = useTheme();

  // Parents and guardians follow their children into squads and teams.
  const showTeams = role !== null && role !== 'guardian' && isTeamRole(role);
  const dob = parseDate(dateOfBirth);
  const guardian = role === 'guardian';
  // A child athlete needs a parent or guardian linked before the app opens for
  // them. Under 13 they can't join at all, so they aren't asked for a parent.
  const child = role === 'athlete' && !!dob && isMinor(dob, false) && !isUnder13(dob);
  const volunteer = role === 'volunteer';
  // Apple's "Hide My Email" signs in with a relay address an admin can't
  // match to PlayHQ. Apple's guidelines say not to then insist on a personal
  // email, so the PlayHQ email stays optional and the form says how it helps.
  const hiddenEmail = isHiddenAppleEmail(session?.user.email);
  const fromDay = parseDate(from);
  const untilDay = parseDate(until);

  useEffect(() => {
    supabase.rpc('join_password_required').then(({ data }) => setNeedsPassword(data === true));
  }, []);

  async function submit() {
    if (!fullName.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!dob) {
      setError('Please enter your date of birth as DD/MM/YYYY.');
      return;
    }
    // Nobody under 13 joins this year (Matt, 18 November 2026). The database
    // checks again and has the final say.
    if (isUnder13(dob)) {
      setError(null);
      setTooYoung(true);
      return;
    }
    if (!role) {
      setError('Please choose what best describes you.');
      return;
    }
    if (child && !guardianEmail.trim()) {
      setError('Please enter the email of a parent or guardian.');
      return;
    }
    if (guardian && !playhqEmail.trim()) {
      setError('Please enter the email you used to register with PlayHQ.');
      return;
    }
    if (guardian && childCode.trim() && !looksLikeLinkCode(childCode)) {
      setError('Enter the 6-letter code from your child’s app, such as 7KQ-4MD, or leave it blank.');
      return;
    }
    if (volunteer && !task.trim()) {
      setError('Please say what you’ll help with.');
      return;
    }
    if (volunteer && (!fromDay || !untilDay)) {
      setError('Please enter your first and last day as DD/MM/YYYY.');
      return;
    }
    if (volunteer && !screening) {
      setError('Please choose how you’re screened to work with children.');
      return;
    }
    if (volunteer && screening === 'card' && !cardNumber.trim()) {
      setError('Please enter your Working With Children Check card number.');
      return;
    }
    if (needsPassword && !password.trim()) {
      setError('Please enter the club password. A club admin can give it to you.');
      return;
    }
    setSaving(true);
    setError(null);
    setTooYoung(false);
    // A wrong club password comes back as a message, not an error, so the
    // database can keep count of wrong tries.
    const { data: refused, error: rpcError } = await supabase.rpc('submit_join_request', {
      p_full_name: fullName,
      p_playhq_email: playhqEmail,
      p_requested_role: role,
      p_requested_team_id: showTeams ? teamId : null,
      p_join_password: needsPassword ? password : null,
      p_date_of_birth: dob,
      p_guardian_email: child ? guardianEmail : null,
    });
    if (refused === under13Message) {
      setSaving(false);
      setTooYoung(true);
      return;
    }
    if (rpcError || refused) {
      setSaving(false);
      setError(rpcError?.message ?? String(refused));
      return;
    }
    if (volunteer) {
      const { error: detailsError } = await supabase.rpc('set_my_volunteer_details', {
        p_task: task,
        p_from: fromDay,
        p_until: untilDay,
        p_screening: screening,
        p_card_number: screening === 'card' ? cardNumber : null,
      });
      if (detailsError) {
        setSaving(false);
        await refresh();
        setError(detailsError.message);
        return;
      }
    }
    if (guardian && childCode.trim()) {
      // A wrong code comes back as a message: the request is sent, so they
      // can try the code again from Home.
      const { data: codeRefused, error: codeError } = await supabase.rpc('enter_child_code', {
        p_code: childCode,
      });
      if (codeError || codeRefused) {
        setSaving(false);
        await refresh();
        setError(
          `Your request is sent, but the code didn’t work: ${codeError?.message ?? String(codeRefused)} You can enter it again from Home.`,
        );
        return;
      }
    }
    setSaving(false);
    await refresh();
    router.back();
  }

  return (
    <Screen>
      <TextField
        label="Your name"
        value={fullName}
        onChangeText={setFullName}
        autoComplete="name"
        textContentType="name"
      />

      <TextField
        label="Date of birth"
        value={dateOfBirth}
        onChangeText={(text) => {
          setDateOfBirth(text);
          setTooYoung(false);
        }}
        placeholder="DD/MM/YYYY"
        keyboardType="numbers-and-punctuation"
        maxLength={10}
      />
      <ThemedText type="small" themeColor="textSecondary">
        A club admin checks it against PlayHQ or ID. It decides whether the club’s rules for
        under 18s apply to you.
      </ThemedText>

      <TextField
        label="PlayHQ email"
        value={playhqEmail}
        onChangeText={setPlayhqEmail}
        placeholder={
          role === 'guardian'
            ? 'Email used to register with PlayHQ'
            : hiddenEmail
              ? 'Optional'
              : (session?.user.email ?? 'Only if different to your sign-in email')
        }
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <ThemedText type="small" themeColor="textSecondary">
        {role === 'guardian'
          ? 'Parents and guardians: enter the email you used to register your athlete with PlayHQ, so we can confirm who you are.'
          : hiddenEmail
            ? 'Optional. You hid your email with Apple, so the club can’t see the email you registered with PlayHQ. Adding it helps a club admin confirm who you are; without it they use your name and date of birth.'
            : 'Only needed if you registered with PlayHQ using a different email to the one you signed in with.'}
      </ThemedText>

      <ChipGroup
        label="I am a"
        options={requestableRoles.map((r) => ({ value: r, label: roleLabels[r] }))}
        selected={role ? [role] : []}
        onToggle={setRole}
      />

      {showTeams ? (
        <ChipGroup
          label={word === 'squad' ? 'Squad' : 'Team'}
          options={groups.map((t) => ({ value: t.id, label: t.name }))}
          selected={teamId ? [teamId] : []}
          onToggle={(id) => setTeamId(id === teamId ? null : id)}
        />
      ) : null}

      {role === 'studio' ? (
        <ThemedText type="small" themeColor="textSecondary">
          For someone who runs the club’s live streams in FirstPass Studio. It doesn’t make you a
          member of the club: it lets Studio read the stats the club records for its games, to show
          on streams, and nothing else. You won’t see the club’s members, squads, calendar or
          messages.
        </ThemedText>
      ) : null}

      {volunteer ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            For someone helping for a day or a short time, paid or unpaid, such as at a carnival,
            clinic or tournament. It doesn’t make you a member of the club: the app is only used to
            onboard you, so the club can check you’re cleared to work with children and keep a
            record. You won’t see the club’s squads, calendar or messages.
          </ThemedText>
          <TextField
            label="What you’ll help with"
            value={task}
            onChangeText={setTask}
            placeholder="For example, bench helper at the State carnival"
            maxLength={200}
            multiline
          />
          <TextField
            label="First day"
            value={from}
            onChangeText={setFrom}
            placeholder="DD/MM/YYYY"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <TextField
            label="Last day"
            value={until}
            onChangeText={setUntil}
            placeholder="DD/MM/YYYY"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <ChipGroup
            label="Working With Children Check"
            options={volunteerScreenings.map((v) => ({
              value: v,
              label: volunteerScreeningLabels[v],
            }))}
            selected={screening ? [screening] : []}
            onToggle={setScreening}
          />
          {screening === 'card' ? (
            <TextField
              label="Card number"
              value={cardNumber}
              onChangeText={setCardNumber}
              autoCapitalize="characters"
              maxLength={30}
            />
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {screening ? volunteerScreeningHelp[screening] : ''}
          </ThemedText>
        </>
      ) : null}

      {needsPassword ? (
        <TextField
          label="Club password"
          value={password}
          onChangeText={setPassword}
          placeholder="Ask a club admin for it"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
      ) : null}

      {guardian ? (
        <>
          <TextField
            label="Your child’s link code"
            value={childCode}
            onChangeText={setChildCode}
            placeholder="7KQ-4MD"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            maxLength={9}
          />
          <ThemedText type="small" themeColor="textSecondary">
            Your child under 18 sees this code in their app when they ask to join. If they haven’t
            yet, leave it blank and enter it from Home later. A club admin checks who you are and
            links you to the child whose code you enter, and you’ll follow them into their {word}s.
          </ThemedText>
        </>
      ) : null}

      {child ? (
        <>
          <TextField
            label="Parent or guardian’s email"
            value={guardianEmail}
            onChangeText={setGuardianEmail}
            placeholder="The email they’ll sign in with"
            autoCapitalize="none"
            autoComplete="off"
            keyboardType="email-address"
          />
          <ThemedText type="small" themeColor="textSecondary">
            You’re under 18, so a parent or guardian needs to join the club in the app too. Once
            you’ve sent your request you’ll see a link code to share with them. The app stays
            locked until a club admin links them to you.
          </ThemedText>
        </>
      ) : null}

      {role === 'athlete' ? (
        <ThemedText type="small" themeColor="textSecondary">
          If you’re under 18: the club keeps your name, date of birth, check-ins, injuries, game
          goals, attendance and the messages sent to you. Your parents or guardians see them. Your
          coaches see your check-ins and injuries once a parent or guardian agrees.
        </ThemedText>
      ) : null}
      <PolicyLinks intro="By joining you agree to the club’s policies:" />
      <ErrorText>{error}</ErrorText>
      {tooYoung ? (
        <>
          <ErrorText>{under13Message}</ErrorText>
          <Pressable accessibilityRole="link" onPress={() => router.push('/delete-account')}>
            <ThemedText type="small" style={{ color: theme.tint }}>
              Not joining? Delete account
            </ThemedText>
          </Pressable>
        </>
      ) : null}
      <Button title="Send request" onPress={submit} busy={saving} />
    </Screen>
  );
}

const volunteerScreenings: VolunteerScreening[] = [
  'card',
  'visitor',
  'national_event',
  'parent',
  'under_18',
  'none',
];

/** What happens next for each answer. */
const volunteerScreeningHelp: Record<VolunteerScreening, string> = {
  card: 'A club admin checks your card online before you help.',
  visitor:
    'If you don’t normally live in WA, you don’t need a WA check for the first two weeks after you arrive, once in any 12 months. A club admin records the day you arrived and you accept a declaration.',
  national_event:
    'If you don’t normally live in WA, you don’t need a WA check for up to 30 days at a national event or tour, once in any 12 months. A club admin records the event and you accept a declaration.',
  parent:
    'A parent volunteering at their own child’s club doesn’t need a check. A club admin links you to your child and you accept a declaration.',
  under_18:
    'Volunteers under 18 don’t need a check. You’ll accept a declaration in the app.',
  none: 'You’ll need a WA Working With Children Check before you help. Apply at workingwithchildren.wa.gov.au and tell a club admin the card number and expiry date when it arrives.',
};
