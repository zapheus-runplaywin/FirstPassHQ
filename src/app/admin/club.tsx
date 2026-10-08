import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Switch, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, ChipGroup, ErrorText, TextField } from '@/components/ui';
import { ClubDefaults, DefaultLogo } from '@/constants/club';
import { contrastRatio, isHexColour, makeColors, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { FEATURES, logoUrl, useClub, type FeatureKey } from '@/lib/club';
import { supabase } from '@/lib/supabase';

const LOGO_TYPES = ['image/png', 'image/jpeg'];
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

type ColourKey = 'background' | 'hero';

const COLOURS: { key: ColourKey; label: string; detail: string }[] = [
  { key: 'background', label: 'Background', detail: 'Behind every screen' },
  { key: 'hero', label: 'Hero colour', detail: 'Buttons, links and highlights' },
];

/** Text is white or black, with a softer shade of it for details. */
type TextTone = 'light' | 'dark';
const TONE_COLOURS: Record<TextTone, string> = { light: '#FFFFFF', dark: '#000000' };
const toneOf = (hex: string | null | undefined): TextTone | null =>
  hex ? (hex.toUpperCase() === TONE_COLOURS.dark ? 'dark' : 'light') : null;

/**
 * The club's name, colours, logo and features. Everything starts on the
 * app's built-in defaults; clearing a value goes back to them.
 */
export default function ClubSettingsScreen() {
  const theme = useTheme();
  const club = useClub();
  const saved = club.profile;

  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [colours, setColours] = useState<Record<ColourKey, string>>({ background: '', hero: '' });
  /** Empty means the build's default. */
  const [textTone, setTextTone] = useState<TextTone | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(club.features);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Fill the form once, from the latest saved settings.
  useEffect(() => {
    club.reload().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [filledFrom, setFilledFrom] = useState<typeof saved | undefined>(undefined);
  if (loaded && filledFrom !== saved) {
    setFilledFrom(saved);
    setName(saved?.club_name ?? '');
    setShortName(saved?.short_name ?? '');
    setColours({
      background: saved?.background_colour ?? '',
      hero: saved?.hero_colour ?? '',
    });
    setTextTone(toneOf(saved?.text_colour));
    setLogoPath(saved?.logo_path ?? null);
    setFeatures(club.features);
  }

  const defaults: Record<ColourKey, string> = {
    background: ClubDefaults.background,
    hero: ClubDefaults.hero,
  };
  const tone = textTone ?? toneOf(ClubDefaults.text) ?? 'light';
  const shown = (key: ColourKey) => {
    const value = colours[key].trim();
    return isHexColour(value) ? value.toUpperCase() : defaults[key];
  };
  const preview = makeColors({
    background: shown('background'),
    text: TONE_COLOURS[tone],
    hero: shown('hero'),
  });
  const badColour = COLOURS.find((c) => colours[c.key].trim() && !isHexColour(colours[c.key]));
  const textContrast = contrastRatio(preview.text, preview.background);
  const heroContrast = contrastRatio(preview.accent, preview.background);

  async function pickLogo() {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: LOGO_TYPES,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset.size && asset.size > MAX_LOGO_BYTES) {
      setError('That image is over 2 MB. Try a smaller PNG.');
      return;
    }
    const contentType = asset.mimeType ?? '';
    if (!LOGO_TYPES.includes(contentType)) {
      setError('Choose a PNG or JPEG image. A square PNG with a see-through background works best.');
      return;
    }
    setUploading(true);
    try {
      const body =
        Platform.OS === 'web' && asset.file ? asset.file : await new File(asset.uri).arrayBuffer();
      const path = `logo-${Date.now()}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
      const { error: uploadError } = await supabase.storage
        .from('club-branding')
        .upload(path, body, { contentType, upsert: false });
      if (uploadError) throw new Error(`The logo didn’t upload: ${uploadError.message}`);
      setLogoPath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The logo didn’t upload. Try again.');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (badColour) {
      setError(`${badColour.label} must be a colour code like #FFCD00.`);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    const { error: saveError } = await supabase.rpc('admin_update_club_profile', {
      p_club_name: name,
      p_short_name: shortName,
      p_background_colour: colours.background,
      p_text_colour: textTone ? TONE_COLOURS[textTone] : '',
      p_hero_colour: colours.hero,
      p_logo_path: logoPath ?? '',
      // Only switched-off features are stored, so new features start on.
      p_features: Object.fromEntries(
        FEATURES.filter((f) => !features[f.key]).map((f) => [f.key, false]),
      ),
    });
    if (saveError) {
      setSaving(false);
      setError(saveError.message);
      return;
    }
    await club.reload();
    setSaving(false);
    setNotice('Saved. Members see the changes next time they open the app.');
  }

  return (
    <Screen>
      <ThemedText type="small" themeColor="textSecondary">
        Set up the app for your club. Anything left empty uses the app’s built-in defaults.
      </ThemedText>

      <View style={styles.section}>
        <ThemedText type="smallBold">Club</ThemedText>
        <TextField
          label="Club name"
          value={name}
          onChangeText={setName}
          placeholder={ClubDefaults.name}
          maxLength={60}
        />
        <TextField
          label="Short name"
          value={shortName}
          onChangeText={setShortName}
          placeholder={ClubDefaults.shortName}
          maxLength={20}
        />
        <ThemedText type="small" themeColor="textSecondary">
          The short name finds your teams in PlayHQ fixtures and names exported files.
        </ThemedText>
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Logo</ThemedText>
        <Card style={[styles.logoCard, { backgroundColor: preview.background }]}>
          <Image
            source={logoPath ? { uri: logoUrl(logoPath) } : DefaultLogo}
            style={styles.logo}
            contentFit="contain"
            accessibilityLabel="Club logo"
          />
        </Card>
        <ThemedText type="small" themeColor="textSecondary">
          A square PNG with a see-through background, up to 2 MB. It shows on the home screen and
          when the app opens. The app icon and splash screen are part of the app build.
        </ThemedText>
        <Button title="Choose logo" variant="secondary" onPress={pickLogo} busy={uploading} />
        {logoPath ? (
          <Pressable accessibilityRole="button" onPress={() => setLogoPath(null)}>
            <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
              Use the built-in logo
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Colours</ThemedText>
        {COLOURS.map((c) => (
          <View key={c.key} style={styles.colourRow}>
            <View
              style={[
                styles.swatch,
                { backgroundColor: shown(c.key), borderColor: theme.textSecondary },
              ]}
            />
            <View style={styles.colourField}>
              <TextField
                label={c.label}
                value={colours[c.key]}
                onChangeText={(value) => setColours({ ...colours, [c.key]: value })}
                placeholder={defaults[c.key]}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={7}
              />
              <ThemedText type="small" themeColor="textSecondary">
                {c.detail}
              </ThemedText>
            </View>
          </View>
        ))}
        <ChipGroup
          label="Text"
          options={[
            { value: 'light', label: 'Light text' },
            { value: 'dark', label: 'Dark text' },
          ]}
          selected={[tone]}
          onToggle={(value) => setTextTone(value)}
        />
        <ThemedText type="small" themeColor="textSecondary">
          Light text suits a dark background, dark text a light one. Details use a softer shade.
        </ThemedText>

        <View style={[styles.preview, { backgroundColor: preview.background }]}>
          <ThemedText type="smallBold" style={{ color: preview.text }}>
            Preview
          </ThemedText>
          <View style={[styles.previewCard, { backgroundColor: preview.backgroundElement }]}>
            <ThemedText type="smallBold" style={{ color: preview.text }}>
              Messages
            </ThemedText>
            <ThemedText type="small" style={{ color: preview.textSecondary }}>
              2 new messages
            </ThemedText>
          </View>
          <View style={[styles.previewButton, { backgroundColor: preview.accent }]}>
            <ThemedText type="smallBold" style={{ color: preview.onAccent }}>
              Button
            </ThemedText>
          </View>
          <ThemedText type="small" style={{ color: preview.tint }}>
            Full calendar
          </ThemedText>
        </View>
        {textContrast < 4.5 ? (
          <ThemedText type="small" themeColor="textSecondary">
            ⚠ The text and background are close in colour, so writing may be hard to read. Try the other text option.
          </ThemedText>
        ) : null}
        {heroContrast < 3 ? (
          <ThemedText type="small" themeColor="textSecondary">
            ⚠ The hero colour is close to the background, so buttons and links may be hard to see.
          </ThemedText>
        ) : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setColours({ background: '', hero: '' });
            setTextTone(null);
          }}>
          <ThemedText type="smallBold" style={[styles.link, { color: theme.tint }]}>
            Use the built-in colours
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold">Features</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Turned-off features disappear from everyone’s app, including the home screen and to-dos.
          Nothing is deleted, so turning one back on brings its records back.
        </ThemedText>
        {FEATURES.map((f) => (
          <Card key={f.key} style={styles.featureRow}>
            <View style={styles.featureText}>
              <ThemedText type="smallBold">{f.label}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {f.detail}
              </ThemedText>
            </View>
            <Switch
              accessibilityLabel={f.label}
              value={features[f.key]}
              onValueChange={(on) => setFeatures({ ...features, [f.key]: on })}
              trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
              thumbColor={theme.text}
              {...(Platform.OS === 'web' ? { activeThumbColor: theme.onAccent } : {})}
            />
          </Card>
        ))}
      </View>

      <ErrorText>{error}</ErrorText>
      {notice ? (
        <ThemedText type="small" themeColor="textSecondary">
          {notice}
        </ThemedText>
      ) : null}
      <Button title="Save club settings" onPress={save} busy={saving} disabled={uploading} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Spacing.two,
  },
  logoCard: {
    alignItems: 'center',
  },
  logo: {
    width: 120,
    height: 120,
  },
  link: {
    paddingVertical: Spacing.two,
  },
  colourRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  colourField: {
    flex: 1,
    gap: Spacing.one,
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 26,
  },
  preview: {
    padding: Spacing.three,
    borderRadius: 12,
    gap: Spacing.two,
  },
  previewCard: {
    padding: Spacing.three,
    borderRadius: 12,
    gap: Spacing.one,
  },
  previewButton: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  featureText: {
    flex: 1,
    gap: Spacing.half,
  },
});
