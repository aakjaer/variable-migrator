
export type VariableType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';

export type PreviewValue =
  | { kind: 'alias'; name: string }
  | { kind: 'color'; hex: string }
  | { kind: 'float'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'string'; value: string };

export interface Variable {
  id: string;
  name: string;
  resolvedType: VariableType;
  description: string;
  valuesByMode: Record<string, any>;
  scopes: string[];
  previewValue?: PreviewValue;
}

export interface Collection {
  id: string;
  name: string;
  modes: { modeId: string; name: string }[];
  variableIds: string[];
}

export interface MigrationState {
  sourceCollectionId: string | null;
  selectedVariableIds: string[];
  targetCollectionId: string | null;
  step: 'SOURCE' | 'VARIABLES' | 'TARGET' | 'MIGRATING' | 'SUCCESS';
}

export interface FigmaMessage {
  type: string;
  payload?: any;
}
