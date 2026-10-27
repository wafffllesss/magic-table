import { describe, expect, it } from 'vitest';
import { detectLocale, errorMessageKey, formatGameLogEvent, i18n, normalizePreference, resolveLocale } from './index';

function flatten(value: Record<string, unknown>, prefix = ''): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') entries.set(path, child);
    else if (child && typeof child === 'object') for (const [nestedKey, nestedValue] of flatten(child as Record<string, unknown>, path)) entries.set(nestedKey, nestedValue);
  }
  return entries;
}

describe('interface locale', () => {
  it('chooses the first supported preferred language and maps every Portuguese region to pt-BR', () => {
    expect(detectLocale(['fr-FR', 'pt-PT', 'en-US'])).toBe('pt-BR');
    expect(detectLocale(['fr-FR', 'en-GB', 'pt-BR'])).toBe('en');
    expect(detectLocale(['pt'])).toBe('pt-BR');
    expect(detectLocale(['fr-FR'])).toBe('en');
    expect(detectLocale(undefined)).toBe('en');
  });

  it('normalizes stored modes and resolves explicit preferences before device preferences', () => {
    expect(normalizePreference('pt-BR')).toBe('pt-BR');
    expect(normalizePreference('invalid')).toBe('auto');
    expect(resolveLocale('en', ['pt-BR'])).toBe('en');
    expect(resolveLocale('pt-BR', ['en-US'])).toBe('pt-BR');
    expect(resolveLocale('auto', ['pt-PT'])).toBe('pt-BR');
  });

  it('keeps the same message keys and interpolation parameters in both catalogs', () => {
    const english = flatten(i18n.global.getLocaleMessage('en') as Record<string, unknown>);
    const portuguese = flatten(i18n.global.getLocaleMessage('pt-BR') as Record<string, unknown>);
    expect([...portuguese.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, message] of english) {
      const parameters = (text: string) => [...text.matchAll(/\{([\w]+)\}/g)].map(match => match[1]).sort();
      expect(parameters(portuguese.get(key)!)).toEqual(parameters(message));
    }
  });

  it('formats plural forms in English and Brazilian Portuguese', () => {
    expect(i18n.global.t('common.cards', 1)).toBe('1 card');
    expect(i18n.global.t('common.cards', 3)).toBe('3 cards');
    i18n.global.locale.value = 'pt-BR';
    expect(i18n.global.t('common.cards', 1)).toBe('1 carta');
    expect(i18n.global.t('common.cards', 3)).toBe('3 cartas');
    i18n.global.locale.value = 'en';
  });

  it('renders shared game events and their phases in each viewer locale', () => {
    const draw = { key: 'gameLog.draw', params: { actor: 'Ana', count: 2 } };
    const phase = { key: 'gameLog.phase', params: { actor: 'Ana', step: 'table.steps.Compra' } };
    i18n.global.locale.value = 'en';
    expect(formatGameLogEvent(draw)).toBe('Ana drew 2 cards.');
    expect(formatGameLogEvent(phase)).toBe('Ana: Draw.');
    i18n.global.locale.value = 'pt-BR';
    expect(formatGameLogEvent(draw)).toBe('Ana comprou 2 cartas.');
    expect(formatGameLogEvent(phase)).toBe('Ana: Compra.');
    i18n.global.locale.value = 'en';
  });

  it('maps known local and remote errors to stable localized keys and hides unknown text', () => {
    expect(errorMessageKey('Não foi possível sincronizar o deck.')).toBe('errors.deckSync');
    expect(errorMessageKey('Diretório indisponível')).toBe('errors.directoryUnavailable');
    expect(errorMessageKey('an opaque remote exception')).toBe('errors.unknown');
  });
});
