export type ContentInventory = {
  path: string;                 // e.g. "hero.title", "services[].title"
  label: string;                // Human-facing field label
  type: 'text' | 'textarea' | 'richtext' | 'url' | 'email' | 'phone' | 'image' | 'repeater' | 'postCollection';
  editable: boolean;
  required: boolean;
  maxLength?: number;
  wpName: string;               // e.g. "hero_title", "services"
  sourceComponent: string;
  defaultValue: unknown;
  notes?: string;
};
