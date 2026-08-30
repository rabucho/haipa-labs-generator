export type AcfFieldType =
  | 'text'
  | 'textarea'
  | 'wysiwyg'
  | 'image'
  | 'url'
  | 'email'
  | 'repeater'
  | 'relationship'
  | 'select';

export type AcfFieldDefinition = {
  key: string;
  label: string;
  name: string;
  type: AcfFieldType;
  required?: 0 | 1;
  instructions?: string;
  maxlength?: string;
  return_format?: 'url' | 'array' | 'id' | 'value';
  sub_fields?: AcfFieldDefinition[];
  collapsed?: string;
  min?: number;
  max?: number;
  layout?: 'table' | 'block' | 'row';
  button_label?: string;
};

export type AcfLocationRule = {
  param: 'post_type' | 'page_template' | 'page' | 'page_type';
  operator: '==' | '!=';
  value: string;
};

export type AcfFieldGroupDefinition = {
  key: string;
  title: string;
  fields: AcfFieldDefinition[];
  location: AcfLocationRule[][];
  menu_order?: number;
  position?: 'normal' | 'side' | 'acf_after_title';
  style?: 'default' | 'seamless';
  label_placement?: 'top' | 'left';
  instruction_placement?: 'label' | 'field';
  hide_on_screen?: string[];
  active?: boolean;
  description?: string;
};
