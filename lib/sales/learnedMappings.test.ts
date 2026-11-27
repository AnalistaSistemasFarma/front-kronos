import { describe, expect, it } from 'vitest';
import { cleanEntries, descriptionKey, findLearned, findSimilarLearned, ingredientSignature, learnedKeys, withLearned, type LearnedMapping } from './learnedMappings';
import type { LinePrediction } from './itemPrediction';

const map = (o: Partial<LearnedMapping>): LearnedMapping => ({
  id: 1, keyType: 'cliente', keyValue: '9999990210', itemCode: 'PTCZ0111', itemName: 'CEFAZOLINA 1G', factor: 1,
  description: 'CEFAZOLINA 1G POLVO PARA SOLUCION INYECTABLE VIAL', createdBy: 'Ana', updatedAt: '2026-11-27T15:00:00.000Z', ...o,
});

describe('learned keys', () => {
  it('reference, EAN and description', () => {
    expect(learnedKeys({ clientCode: ' 9999990210 ', barcode: '7707234231363', description: 'Cefazolina  1G – vial' }))
      .toEqual([{ type: 'cliente', value: '9999990210' }, { type: 'ean', value: '7707234231363' }, { type: 'desc', value: 'cefazolina 1g vial' }]);
    expect(learnedKeys({ barcode: '123', description: 'ab' })).toEqual([]);
    expect(descriptionKey('ÁCIDO  Ascórbico')).toBe('acido ascorbico');
  });
});

describe('findLearned', () => {
  it('direct match by customer reference with reason', () => {
    const r = findLearned({ clientCode: '9999990210', description: 'otra cosa' }, [map({})])!;
    expect(r.mapping.itemCode).toBe('PTCZ0111');
    expect(r.reason).toBe('Aprendido: montado así el 2026-11-27 por Ana (por referencia del cliente)');
  });
  it('no match for another customer key', () => {
    expect(findLearned({ clientCode: '1' }, [map({})])).toBeNull();
  });
});

describe('findSimilarLearned', () => {
  it('same ingredient and strength, other description', () => {
    expect(ingredientSignature('CEFAZOLINA 1 G VIAL X 10')).toBe(ingredientSignature('Cefazolina 1000 mg polvo'));
    const r = findSimilarLearned({ description: 'CEFAZOLINA SODICA 1 G' }, [map({ description: 'CEFAZOLINA SODICA 1000MG VIAL' })]);
    expect(r?.mapping.itemCode).toBe('PTCZ0111');
    expect(r?.reason).toMatch(/^Sugerencia corregida/);
  });
  it('different strength or conflicting mappings: nothing', () => {
    expect(findSimilarLearned({ description: 'CEFAZOLINA 500 MG' }, [map({})])).toBeNull();
    expect(findSimilarLearned({ description: 'CEFAZOLINA 1G' }, [map({}), map({ id: 2, itemCode: 'OTRO' })])).toBeNull();
    expect(findSimilarLearned({ description: 'CEFAZOLINA' }, [map({ description: 'CEFAZOLINA' })])).toBeNull();
  });
});

describe('withLearned', () => {
  const pred: LinePrediction = { confidence: 'media', reason: 'x', autoSelected: false, candidates: [{ ItemCode: 'PTCZ0121', ItemName: 'CEFA 10', score: 0.6, reason: 'x', factor: 1 }, { ItemCode: 'PTCZ0111', ItemName: 'CEFA', score: 0.5, reason: 'y', factor: 1 }] };
  it('direct mapping goes first as alta', () => {
    const [r] = withLearned([{ input: { ClientCode: '9999990210', ItemDescription: 'CEFAZOLINA 1G' }, prediction: pred }], [map({})]);
    expect(r.prediction.confidence).toBe('alta');
    expect(r.prediction.candidates.map((c) => c.ItemCode)).toEqual(['PTCZ0111', 'PTCZ0121']);
    expect(r.learned).toMatchObject({ kind: 'directo', id: 1 });
  });
  it('similar mapping is media', () => {
    const [r] = withLearned([{ input: { ClientCode: '555', ItemDescription: 'CEFAZOLINA 1 G AMPOLLA' }, prediction: { ...pred, confidence: 'baja' } }], [map({})]);
    expect(r.prediction.confidence).toBe('media');
    expect(r.learned?.kind).toBe('similar');
  });
  it('no mappings: unchanged', () => {
    const rows = [{ input: { ItemDescription: 'X' }, prediction: pred }];
    expect(withLearned(rows, [])).toBe(rows);
  });
});

describe('cleanEntries', () => {
  it('drops entries without keys and clamps the factor', () => {
    expect(cleanEntries([{ itemCode: 'A', clientCode: '1', factor: -3 }, { itemCode: 'B' }, null])).toEqual([
      { itemCode: 'A', itemName: '', factor: 1, clientCode: '1', barcode: null, description: null },
    ]);
    expect(cleanEntries('x')).toEqual([]);
  });
});
