import { z } from 'zod';
import { LocalizedText } from './localized-text';

/**
 * The controlled facet vocabulary (concept §6). **This file is the single source of truth.**
 *
 * Everything downstream is derived from it: the Zod enums below, the `facet` / `facet_value` seed
 * in `@moodboard/db`, the LLM prompt, and the MCP `list_vocabulary` response. Removing a value
 * here therefore breaks compilation rather than failing at runtime — that is the stated purpose
 * of this library (§3).
 *
 * `value` is the machine-readable key. It stays English and single-language because it feeds the
 * Zod enums, the prompt and the MCP filters (§13.3). Only `label` and `description` are
 * translated, and they live in `jsonb` (§13.5).
 *
 * Extending an existing facet is cheap. Adding a **new facet** costs prompt space — and therefore
 * accuracy on the remaining facets — plus a re-analysis of the whole corpus (§6, §7.5).
 */

/** A facet definition with its values. `V` stays a tuple so `z.enum` keeps the literal types. */
export interface FacetDefinition<
  K extends string,
  V extends readonly string[],
> {
  readonly key: K;
  /** Multiple values per asset allowed? Mirrors `facet.is_multi_value`. */
  readonly isMultiValue: boolean;
  readonly label: LocalizedText;
  readonly description: LocalizedText;
  /** Ordered: the index becomes `facet_value.sort_order`. */
  readonly values: V;
  /** One label per value — a missing one is a compile error. */
  readonly valueLabels: Readonly<Record<V[number], LocalizedText>>;
}

function defineFacet<K extends string, const V extends readonly string[]>(
  definition: FacetDefinition<K, V>,
): FacetDefinition<K, V> {
  return definition;
}

export const TYPE_VALUES = [
  'image',
  'component',
  'font',
  'palette',
  'website',
] as const;

export const UI_PATTERN_VALUES = [
  'hero',
  'nav',
  'footer',
  'pricing',
  'card',
  'form',
  'table',
  'dashboard',
  'onboarding',
  'auth',
  'empty-state',
  'modal',
  'sidebar',
  'gallery',
  'testimonial',
  'cta',
  'blog-post',
  'product-detail',
] as const;

export const STYLE_VALUES = [
  'minimal',
  'brutalist',
  'neo-brutal',
  'glassmorphism',
  'editorial',
  'swiss',
  'retro',
  'memphis',
  'corporate',
  'playful',
  'luxury',
  'tech',
  'organic',
  'maximalist',
] as const;

export const MOOD_VALUES = [
  'calm',
  'energetic',
  'luxurious',
  'playful',
  'technical',
  'warm',
  'cool',
  'serious',
  'friendly',
  'dramatic',
] as const;

export const THEME_VALUES = ['light', 'dark', 'both'] as const;

export const DENSITY_VALUES = ['airy', 'balanced', 'dense'] as const;

export const TYPOGRAPHY_VALUES = [
  'serif',
  'sans',
  'mono',
  'display',
  'script',
  'mixed',
  'oversized',
  'condensed',
] as const;

export const LAYOUT_VALUES = [
  'centered',
  'split',
  'asymmetric',
  'grid',
  'full-bleed',
  'sidebar',
  'stacked',
  'overlapping',
] as const;

export const MOTION_VALUES = [
  'none',
  'fade',
  'slide',
  'parallax',
  'scroll-reveal',
  'hover-transform',
  '3d',
  'morphing',
  'marquee',
  'sticky-scroll',
  'cursor-follow',
  'video-bg',
] as const;

export const INDUSTRY_VALUES = [
  'saas',
  'fashion',
  'finance',
  'food',
  'health',
  'education',
  'agency',
  'ecommerce',
  'media',
  'gaming',
  'nonprofit',
  'real-estate',
] as const;

/** Curated per client or project by an admin, so it ships with no values (§6). */
export const PROJECT_VALUES = [] as const;

export const TypeEnum = z.enum(TYPE_VALUES);
export const UiPatternEnum = z.enum(UI_PATTERN_VALUES);
export const StyleEnum = z.enum(STYLE_VALUES);
export const MoodEnum = z.enum(MOOD_VALUES);
export const ThemeEnum = z.enum(THEME_VALUES);
export const DensityEnum = z.enum(DENSITY_VALUES);
export const TypographyEnum = z.enum(TYPOGRAPHY_VALUES);
export const LayoutEnum = z.enum(LAYOUT_VALUES);
export const MotionEnum = z.enum(MOTION_VALUES);
export const IndustryEnum = z.enum(INDUSTRY_VALUES);

export type AssetType = z.infer<typeof TypeEnum>;
export type UiPattern = z.infer<typeof UiPatternEnum>;
export type Style = z.infer<typeof StyleEnum>;
export type Mood = z.infer<typeof MoodEnum>;
export type Theme = z.infer<typeof ThemeEnum>;
export type Density = z.infer<typeof DensityEnum>;
export type Typography = z.infer<typeof TypographyEnum>;
export type Layout = z.infer<typeof LayoutEnum>;
export type Motion = z.infer<typeof MotionEnum>;
export type Industry = z.infer<typeof IndustryEnum>;

export const TYPE_FACET = defineFacet({
  key: 'type',
  isMultiValue: false,
  label: { en: 'Type', de: 'Typ' },
  description: {
    en: 'What kind of asset this is.',
    de: 'Um welche Art von Asset es sich handelt.',
  },
  values: TYPE_VALUES,
  valueLabels: {
    image: { en: 'Image', de: 'Bild' },
    component: { en: 'Component', de: 'Komponente' },
    font: { en: 'Font', de: 'Schriftart' },
    palette: { en: 'Palette', de: 'Farbpalette' },
    website: { en: 'Website', de: 'Website' },
  },
});

export const UI_PATTERN_FACET = defineFacet({
  key: 'ui_pattern',
  isMultiValue: true,
  label: { en: 'UI pattern', de: 'UI-Muster' },
  description: {
    en: 'The interface patterns visible in the asset.',
    de: 'Die im Asset sichtbaren Interface-Muster.',
  },
  values: UI_PATTERN_VALUES,
  valueLabels: {
    hero: { en: 'Hero', de: 'Hero' },
    nav: { en: 'Navigation', de: 'Navigation' },
    footer: { en: 'Footer', de: 'Footer' },
    pricing: { en: 'Pricing', de: 'Preistabelle' },
    card: { en: 'Card', de: 'Karte' },
    form: { en: 'Form', de: 'Formular' },
    table: { en: 'Table', de: 'Tabelle' },
    dashboard: { en: 'Dashboard', de: 'Dashboard' },
    onboarding: { en: 'Onboarding', de: 'Onboarding' },
    auth: { en: 'Authentication', de: 'Anmeldung' },
    'empty-state': { en: 'Empty state', de: 'Leerzustand' },
    modal: { en: 'Modal', de: 'Modal' },
    sidebar: { en: 'Sidebar', de: 'Seitenleiste' },
    gallery: { en: 'Gallery', de: 'Galerie' },
    testimonial: { en: 'Testimonial', de: 'Kundenstimme' },
    cta: { en: 'Call to action', de: 'Handlungsaufforderung' },
    'blog-post': { en: 'Blog post', de: 'Blogbeitrag' },
    'product-detail': { en: 'Product detail', de: 'Produktdetail' },
  },
});

export const STYLE_FACET = defineFacet({
  key: 'style',
  isMultiValue: true,
  label: { en: 'Style', de: 'Stil' },
  description: {
    en: 'The visual language. Note that "playful" also exists as a mood — here it describes the visual language, there the effect on the viewer.',
    de: 'Die visuelle Sprache. "Verspielt" existiert auch als Stimmung — hier beschreibt es die visuelle Sprache, dort die Wirkung auf den Betrachter.',
  },
  values: STYLE_VALUES,
  valueLabels: {
    minimal: { en: 'Minimal', de: 'Minimalistisch' },
    brutalist: { en: 'Brutalist', de: 'Brutalistisch' },
    'neo-brutal': { en: 'Neo-brutalist', de: 'Neo-brutalistisch' },
    glassmorphism: { en: 'Glassmorphism', de: 'Glasmorphismus' },
    editorial: { en: 'Editorial', de: 'Editorial' },
    swiss: { en: 'Swiss', de: 'Schweizer Stil' },
    retro: { en: 'Retro', de: 'Retro' },
    memphis: { en: 'Memphis', de: 'Memphis' },
    corporate: { en: 'Corporate', de: 'Corporate' },
    playful: { en: 'Playful', de: 'Verspielt' },
    luxury: { en: 'Luxury', de: 'Luxuriös' },
    tech: { en: 'Tech', de: 'Tech' },
    organic: { en: 'Organic', de: 'Organisch' },
    maximalist: { en: 'Maximalist', de: 'Maximalistisch' },
  },
});

export const MOOD_FACET = defineFacet({
  key: 'mood',
  isMultiValue: true,
  label: { en: 'Mood', de: 'Stimmung' },
  description: {
    en: 'The effect on the viewer, as opposed to the visual language captured by "style".',
    de: 'Die Wirkung auf den Betrachter — im Unterschied zur visuellen Sprache, die der Stil beschreibt.',
  },
  values: MOOD_VALUES,
  valueLabels: {
    calm: { en: 'Calm', de: 'Ruhig' },
    energetic: { en: 'Energetic', de: 'Energetisch' },
    luxurious: { en: 'Luxurious', de: 'Luxuriös' },
    playful: { en: 'Playful', de: 'Verspielt' },
    technical: { en: 'Technical', de: 'Technisch' },
    warm: { en: 'Warm', de: 'Warm' },
    cool: { en: 'Cool', de: 'Kühl' },
    serious: { en: 'Serious', de: 'Seriös' },
    friendly: { en: 'Friendly', de: 'Freundlich' },
    dramatic: { en: 'Dramatic', de: 'Dramatisch' },
  },
});

export const THEME_FACET = defineFacet({
  key: 'theme',
  isMultiValue: false,
  label: { en: 'Theme', de: 'Farbschema' },
  description: {
    en: 'Light, dark, or both offered side by side.',
    de: 'Hell, dunkel oder beides nebeneinander angeboten.',
  },
  values: THEME_VALUES,
  valueLabels: {
    light: { en: 'Light', de: 'Hell' },
    dark: { en: 'Dark', de: 'Dunkel' },
    both: { en: 'Both', de: 'Beides' },
  },
});

export const DENSITY_FACET = defineFacet({
  key: 'density',
  isMultiValue: false,
  label: { en: 'Density', de: 'Dichte' },
  description: {
    en: 'How much whitespace the layout gives its content.',
    de: 'Wie viel Weißraum das Layout seinem Inhalt zugesteht.',
  },
  values: DENSITY_VALUES,
  valueLabels: {
    airy: { en: 'Airy', de: 'Luftig' },
    balanced: { en: 'Balanced', de: 'Ausgewogen' },
    dense: { en: 'Dense', de: 'Dicht' },
  },
});

export const TYPOGRAPHY_FACET = defineFacet({
  key: 'typography',
  isMultiValue: true,
  label: { en: 'Typography', de: 'Typografie' },
  description: {
    en: 'The typefaces in use and how they are deployed.',
    de: 'Die verwendeten Schriften und ihr Einsatz.',
  },
  values: TYPOGRAPHY_VALUES,
  valueLabels: {
    serif: { en: 'Serif', de: 'Serif' },
    sans: { en: 'Sans-serif', de: 'Serifenlos' },
    mono: { en: 'Monospace', de: 'Monospace' },
    display: { en: 'Display', de: 'Display' },
    script: { en: 'Script', de: 'Schreibschrift' },
    mixed: { en: 'Mixed', de: 'Gemischt' },
    oversized: { en: 'Oversized', de: 'Übergroß' },
    condensed: { en: 'Condensed', de: 'Schmal' },
  },
});

export const LAYOUT_FACET = defineFacet({
  key: 'layout',
  isMultiValue: true,
  label: { en: 'Layout', de: 'Layout' },
  description: {
    en: 'How the content is arranged on the surface.',
    de: 'Wie der Inhalt auf der Fläche angeordnet ist.',
  },
  values: LAYOUT_VALUES,
  valueLabels: {
    centered: { en: 'Centered', de: 'Zentriert' },
    split: { en: 'Split', de: 'Geteilt' },
    asymmetric: { en: 'Asymmetric', de: 'Asymmetrisch' },
    grid: { en: 'Grid', de: 'Raster' },
    'full-bleed': { en: 'Full-bleed', de: 'Randabfallend' },
    sidebar: { en: 'Sidebar', de: 'Seitenleiste' },
    stacked: { en: 'Stacked', de: 'Gestapelt' },
    overlapping: { en: 'Overlapping', de: 'Überlappend' },
  },
});

export const MOTION_FACET = defineFacet({
  key: 'motion',
  isMultiValue: true,
  label: { en: 'Motion', de: 'Bewegung' },
  description: {
    en: 'Animation and movement. A single screenshot cannot fill this facet — it is what the capture keyframes are for (§8.2).',
    de: 'Animation und Bewegung. Ein einzelner Screenshot kann dieses Facet nicht füllen — dafür gibt es die Keyframes der Capture (§8.2).',
  },
  values: MOTION_VALUES,
  valueLabels: {
    none: { en: 'None', de: 'Keine' },
    fade: { en: 'Fade', de: 'Überblendung' },
    slide: { en: 'Slide', de: 'Einschieben' },
    parallax: { en: 'Parallax', de: 'Parallaxe' },
    'scroll-reveal': { en: 'Scroll reveal', de: 'Scroll-Einblendung' },
    'hover-transform': { en: 'Hover transform', de: 'Hover-Transformation' },
    '3d': { en: '3D', de: '3D' },
    morphing: { en: 'Morphing', de: 'Morphing' },
    marquee: { en: 'Marquee', de: 'Laufband' },
    'sticky-scroll': { en: 'Sticky scroll', de: 'Sticky-Scroll' },
    'cursor-follow': { en: 'Cursor follow', de: 'Cursor-Verfolgung' },
    'video-bg': { en: 'Video background', de: 'Video-Hintergrund' },
  },
});

export const INDUSTRY_FACET = defineFacet({
  key: 'industry',
  isMultiValue: true,
  label: { en: 'Industry', de: 'Branche' },
  description: {
    en: 'The industry the asset comes from or addresses.',
    de: 'Die Branche, aus der das Asset stammt oder die es adressiert.',
  },
  values: INDUSTRY_VALUES,
  valueLabels: {
    saas: { en: 'SaaS', de: 'SaaS' },
    fashion: { en: 'Fashion', de: 'Mode' },
    finance: { en: 'Finance', de: 'Finanzen' },
    food: { en: 'Food', de: 'Gastronomie' },
    health: { en: 'Health', de: 'Gesundheit' },
    education: { en: 'Education', de: 'Bildung' },
    agency: { en: 'Agency', de: 'Agentur' },
    ecommerce: { en: 'E-commerce', de: 'E-Commerce' },
    media: { en: 'Media', de: 'Medien' },
    gaming: { en: 'Gaming', de: 'Gaming' },
    nonprofit: { en: 'Non-profit', de: 'Non-Profit' },
    'real-estate': { en: 'Real estate', de: 'Immobilien' },
  },
});

export const PROJECT_FACET = defineFacet({
  key: 'project',
  isMultiValue: true,
  label: { en: 'Project', de: 'Projekt' },
  description: {
    en: 'Free-form, curated per client or project by an admin. Ships with no values.',
    de: 'Frei definiert, von Admins pro Kunde oder Projekt gepflegt. Wird ohne Werte ausgeliefert.',
  },
  values: PROJECT_VALUES,
  valueLabels: {},
});

/** Every facet, in the order they are presented and seeded. */
export const VOCABULARY = [
  TYPE_FACET,
  UI_PATTERN_FACET,
  STYLE_FACET,
  MOOD_FACET,
  THEME_FACET,
  DENSITY_FACET,
  TYPOGRAPHY_FACET,
  LAYOUT_FACET,
  MOTION_FACET,
  INDUSTRY_FACET,
  PROJECT_FACET,
] as const;

export const FACET_KEYS = VOCABULARY.map((facet) => facet.key);
export type FacetKey = (typeof VOCABULARY)[number]['key'];

/** Flat shape for the seed and for `list_vocabulary`, with `sort_order` already resolved. */
export interface VocabularyEntry {
  readonly facetKey: string;
  readonly isMultiValue: boolean;
  readonly facetLabel: LocalizedText;
  readonly facetDescription: LocalizedText;
  readonly value: string;
  readonly sortOrder: number;
  readonly label: LocalizedText;
}

export function flattenVocabulary(): VocabularyEntry[] {
  return VOCABULARY.flatMap((facet) =>
    facet.values.map((value, index) => ({
      facetKey: facet.key,
      isMultiValue: facet.isMultiValue,
      facetLabel: facet.label,
      facetDescription: facet.description,
      value,
      sortOrder: index,
      label: (facet.valueLabels as Record<string, LocalizedText>)[value],
    })),
  );
}
