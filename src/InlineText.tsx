import { CloudText } from "./CloudText";
import type { RichEditorProps } from "./CloudText";
export function InlineText(props: RichEditorProps) {
  return <CloudText {...props} />;
}
