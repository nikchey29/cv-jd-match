import { MAX_INPUT_CHARS } from "../../lib/limits";

interface Props {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}

/** A labelled text area with a live character count. */
export function TextInput({ id, label, hint, value, onChange, disabled }: Props) {
  const tooLong = value.length > MAX_INPUT_CHARS;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <p className="hint" id={`${id}-hint`}>
        {hint}
      </p>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        rows={12}
        spellCheck={false}
        aria-describedby={`${id}-hint ${id}-count`}
        aria-invalid={tooLong}
      />
      <p id={`${id}-count`} className={tooLong ? "count count-over" : "count"}>
        {value.length.toLocaleString("en-US")} / {MAX_INPUT_CHARS.toLocaleString("en-US")} characters
        {tooLong ? " (too long)" : ""}
      </p>
    </div>
  );
}
