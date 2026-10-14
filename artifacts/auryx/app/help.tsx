/**
 * help.tsx — In-app Knowledge Base (دليل الاستخدام).
 *
 * A central, searchable guide covering every Auryx feature plus a
 * dedicated privacy section ("البيانات التي نجمعها — ولماذا").
 *
 * Design decisions:
 *   • Single vertical scroll + accordion categories (mobile-native pattern).
 *   • Sticky search bar (fixed above the scroll area) with instant filtering.
 *   • Smart search: matches titles, bodies AND keywords in BOTH languages,
 *     so typing "guardian" finds the Arabic article and vice-versa.
 *   • Matched words are highlighted in gold inside titles & snippets.
 *   • Content lives in utils/help-articles.ts (bilingual) — no translation
 *     JSON changes required.
 */

import React, { useMemo, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useLanguage } from '@/contexts/LanguageContext';
import { useTheme, ThemeColors } from '@/contexts/ThemeContext';
import { ScreenGlow } from '@/components/shared/ScreenGlow';
import {
  HELP_CATEGORIES,
  type HelpArticle,
  type HelpCategory,
  type HelpLang,
} from '@/utils/help-articles';

// ── Search helpers ────────────────────────────────────────────────────────────

const normalize = (s: string) => s.toLowerCase().trim();
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface FlatResult {
  cat: HelpCategory;
  article: HelpArticle;
}

/** Searchable string: both languages, title + body + keywords. */
function buildHaystack(a: HelpArticle): string {
  return normalize(
    [a.title.ar, a.title.en, a.body.ar, a.body.en, a.keywords.ar, a.keywords.en].join(' '),
  );
}

/** Surrounding context around the first match, for result previews. */
function snippet(a: HelpArticle, lang: HelpLang, q: string): string {
  const body = a.body[lang];
  const idx = normalize(body).indexOf(normalize(q));
  if (idx < 0) return body.split('\n')[0];
  const start = Math.max(0, idx - 40);
  const end = Math.min(body.length, idx + q.length + 60);
  return (start > 0 ? '…' : '') + body.slice(start, end) + (end < body.length ? '…' : '');
}

/** Renders text with every occurrence of `query` highlighted in gold. */
function Highlighted({ text, query, style, highlight }: {
  text: string;
  query: string;
  style: any;
  highlight: string;
}) {
  const q = normalize(query);
  if (!q) return <Text style={style}>{text}</Text>;
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'ig'));
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        normalize(p) === q ? (
          <Text key={i} style={[style, { color: highlight, fontWeight: '700' }]}>{p}</Text>
        ) : (
          <Text key={i} style={style}>{p}</Text>
        ),
      )}
    </Text>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language } = useLanguage();
  const lang: HelpLang = (language ?? 'ar').startsWith('ar') ? 'ar' : 'en';
  const isRTL = lang === 'ar';
  const { colors: tc } = useTheme();

  const [query, setQuery] = useState('');
  const [openCat, setOpenCat] = useState<string | null>(HELP_CATEGORIES[0]?.id ?? null);
  const [openArticle, setOpenArticle] = useState<string | null>(null);

  const styles = useMemo(() => makeStyles(tc, isRTL ? 'rtl' : 'ltr'), [tc, isRTL]);
  const L = (ar: string, en: string) => (isRTL ? ar : en);

  const q = normalize(query);

  const results = useMemo<FlatResult[]>(() => {
    if (!q) return [];
    const out: FlatResult[] = [];
    for (const cat of HELP_CATEGORIES) {
      for (const article of cat.articles) {
        if (buildHaystack(article).includes(q)) out.push({ cat, article });
      }
    }
    return out;
  }, [q]);

  return (
    <View style={[styles.container, { backgroundColor: tc.background }]}>
      <ScreenGlow color="#D4AF37" icon="book-open" />

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name={isRTL ? 'chevron-right' : 'chevron-left'} size={20} color={tc.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{L('دليل الاستخدام', 'Help Guide')}</Text>
        <View style={{ width: 38 }} />
      </View>

      {/* ── Sticky search bar ── */}
      <View style={styles.searchWrap}>
        <Feather name="search" size={16} color={tc.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder={L('ابحث عن أي ميزة… مثال: وصي، نسخة، خصوصية', 'Search any feature… e.g. guardian, backup, privacy')}
          placeholderTextColor={tc.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
        />
        {q ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x-circle" size={16} color={tc.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 4, paddingBottom: insets.bottom + 30 }}
        keyboardShouldPersistTaps="handled"
      >
        {q ? (
          /* ═══ SEARCH MODE ═══ */
          <>
            <Text style={styles.resultsCount}>
              {L(`نتائج البحث: ${results.length}`, `Search results: ${results.length}`)}
            </Text>

            {results.length === 0 ? (
              <View style={styles.empty}>
                <Feather name="search" size={34} color={tc.textMuted} />
                <Text style={styles.emptyTitle}>{L('لا توجد نتائج', 'No results')}</Text>
                <Text style={styles.emptySub}>
                  {L(
                    `لم نجد ما يطابق "${query}". جرّب كلمة أخرى مثل: رمز، وصي، نسخة، خصوصية.`,
                    `Nothing matches "${query}". Try another word like: PIN, guardian, backup, privacy.`,
                  )}
                </Text>
              </View>
            ) : (
              results.map(({ cat, article }) => {
                const open = openArticle === article.id;
                return (
                  <View key={article.id} style={[styles.catCard, { borderColor: `${cat.color}30` }]}>
                    <TouchableOpacity
                      style={styles.catHeader}
                      onPress={() => setOpenArticle(open ? null : article.id)}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.catIcon, { backgroundColor: `${cat.color}18`, borderColor: `${cat.color}35` }]}>
                        <Feather name={cat.icon as any} size={18} color={cat.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.catLabel, { color: cat.color }]}>{cat.title[lang]}</Text>
                        <Highlighted text={article.title[lang]} query={query} style={styles.articleTitle} highlight={tc.gold} />
                        <Highlighted text={snippet(article, lang, q)} query={query} style={styles.snippet} highlight={tc.gold} />
                      </View>
                      <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={tc.textMuted} />
                    </TouchableOpacity>

                    {open && (
                      <View style={[styles.articleBody, { borderStartColor: cat.color, marginHorizontal: 12, marginBottom: 12 }]}>
                        <Text style={styles.articleBodyText}>{article.body[lang]}</Text>
                      </View>
                    )}
                  </View>
                );
              })
            )}
          </>
        ) : (
          /* ═══ BROWSE MODE (accordion) ═══ */
          HELP_CATEGORIES.map((cat) => {
            const open = openCat === cat.id;
            return (
              <View key={cat.id} style={[styles.catCard, { borderColor: `${cat.color}30` }]}>
                <TouchableOpacity
                  style={styles.catHeader}
                  onPress={() => { setOpenCat(open ? null : cat.id); setOpenArticle(null); }}
                  activeOpacity={0.8}
                >
                  <View style={[styles.catIcon, { backgroundColor: `${cat.color}18`, borderColor: `${cat.color}35` }]}>
                    <Feather name={cat.icon as any} size={18} color={cat.color} />
                  </View>
                  <Text style={[styles.catTitle, { color: cat.color }]}>{cat.title[lang]}</Text>
                  <View style={styles.catCount}>
                    <Text style={styles.catCountText}>{cat.articles.length}</Text>
                  </View>
                  <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={tc.textMuted} />
                </TouchableOpacity>

                {open &&
                  cat.articles.map((a) => {
                    const aOpen = openArticle === a.id;
                    return (
                      <View key={a.id} style={styles.articleWrap}>
                        <TouchableOpacity
                          style={styles.articleHeader}
                          onPress={() => setOpenArticle(aOpen ? null : a.id)}
                          activeOpacity={0.8}
                        >
                          <View style={[styles.articleDot, { backgroundColor: cat.color }]} />
                          <Text style={[styles.articleTitle, aOpen && { color: cat.color }]}>
                            {a.title[lang]}
                          </Text>
                          <Feather name={aOpen ? 'chevron-up' : 'chevron-down'} size={14} color={tc.textMuted} />
                        </TouchableOpacity>

                        {aOpen && (
                          <View style={[styles.articleBody, { borderStartColor: cat.color }]}>
                            <Text style={styles.articleBodyText}>{a.body[lang]}</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
              </View>
            );
          })
        )}

        {/* ── Footer ─ */}
        <View style={styles.footer}>
          <Feather name="shield" size={12} color={tc.gold} />
          <Text style={styles.footerText}>
            {L(
              'Auryx — بياناتك مشفرة طرفياً لطرف. لا نبيع ولا نشارك بياناتك مع أي جهة.',
              'Auryx — your data is end-to-end encrypted. We never sell or share it.',
            )}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (tc: ThemeColors, wd: 'rtl' | 'ltr') =>
  StyleSheet.create({
    container: { flex: 1 },
    header: {
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20, paddingBottom: 10,
    },
    backBtn: {
      width: 38, height: 38, borderRadius: 12,
      backgroundColor: tc.glass, borderWidth: 1,
      borderColor: tc.glassBorder, alignItems: 'center', justifyContent: 'center',
    },
    headerTitle: {
      fontSize: 18, fontWeight: '700', color: tc.text,
      fontFamily: 'Poppins_700Bold', letterSpacing: 1,
    },
    searchWrap: {
      flexDirection: 'row', alignItems: 'center',
      marginHorizontal: 20, marginBottom: 12,
      backgroundColor: tc.glass, borderWidth: 1, borderColor: tc.glassBorder,
      borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11,
    },
    searchInput: {
      flex: 1, fontSize: 13, color: tc.text,
      fontFamily: 'Poppins_400Regular', padding: 0, marginHorizontal: 8,
      writingDirection: wd,
    },
    resultsCount: {
      fontSize: 11, color: tc.textMuted, fontFamily: 'Poppins_400Regular',
      marginHorizontal: 24, marginBottom: 8, writingDirection: wd,
    },
    catCard: {
      marginHorizontal: 20, marginBottom: 12, borderRadius: 16,
      borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.02)', overflow: 'hidden',
    },
    catHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
    catIcon: {
      width: 36, height: 36, borderRadius: 10, borderWidth: 1,
      alignItems: 'center', justifyContent: 'center',
    },
    catTitle: {
      flex: 1, fontSize: 14, fontWeight: '700',
      fontFamily: 'Poppins_700Bold', writingDirection: wd,
    },
    catCount: {
      paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
      backgroundColor: 'rgba(255,255,255,0.06)',
    },
    catCountText: { fontSize: 10, color: tc.textMuted, fontFamily: 'Poppins_600SemiBold' },
    catLabel: {
      fontSize: 10, fontWeight: '700', fontFamily: 'Poppins_700Bold',
      marginBottom: 2, writingDirection: wd,
    },
    articleWrap: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
    articleHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingVertical: 12, paddingHorizontal: 14,
    },
    articleDot: { width: 6, height: 6, borderRadius: 3 },
    articleTitle: {
      flex: 1, fontSize: 13, color: tc.text,
      fontFamily: 'Poppins_600SemiBold', writingDirection: wd,
    },
    snippet: {
      fontSize: 11, color: tc.textMuted, fontFamily: 'Poppins_400Regular',
      marginTop: 2, writingDirection: wd,
    },
    articleBody: {
      marginHorizontal: 14, marginBottom: 14, padding: 12,
      borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)',
      borderStartWidth: 3,
    },
    articleBodyText: {
      fontSize: 12, lineHeight: 20, color: tc.textSecondary,
      fontFamily: 'Poppins_400Regular', writingDirection: wd,
    },
    empty: { alignItems: 'center', paddingVertical: 50, paddingHorizontal: 30, gap: 10 },
    emptyTitle: { fontSize: 15, fontWeight: '700', color: tc.text, fontFamily: 'Poppins_700Bold' },
    emptySub: {
      fontSize: 12, color: tc.textMuted, textAlign: 'center',
      lineHeight: 19, fontFamily: 'Poppins_400Regular', writingDirection: wd,
    },
    footer: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      justifyContent: 'center', paddingHorizontal: 30, paddingVertical: 18,
    },
    footerText: {
      flex: 1, fontSize: 10, color: tc.textMuted, textAlign: 'center',
      fontFamily: 'Poppins_400Regular', writingDirection: wd,
    },
  });