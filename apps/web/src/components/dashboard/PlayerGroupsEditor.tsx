import { useState } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { Combobox, ComboboxInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList } from '../ui/combobox';

type Props = {
  playerId: string;
  groups: string[];
  allGroups: string[];
};

export default function PlayerGroupsEditor({ playerId, groups, allGroups }: Props) {
  // Base UI `value`/`onValueChange` track the selected item; the free-text the
  // user types lives in `inputValue`. Tracking the input value is what makes
  // add-or-create work: a brand-new name never matches an item, so only the
  // typed text reaches the Add handler.
  const [inputValue, setInputValue] = useState('');
  const [pending, setPending] = useState(false);
  const suggestions = allGroups.filter((g) => !groups.includes(g));

  async function mutate(method: 'POST' | 'DELETE', name: string) {
    setPending(true);
    try {
      const res = await fetch(`/api/players/${playerId}/groups`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (r.ok) {
        location.reload();
      } else {
        toast.error(r.error ?? 'Could not update groups.');
        setPending(false);
      }
    } catch {
      toast.error('Could not update groups.');
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {groups.length === 0 && <span className="text-sm text-muted-foreground">No groups.</span>}
        {groups.map((g) => (
          <span key={g} className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-sm">
            {g}
            <button
              type="button"
              aria-label={`Remove ${g}`}
              disabled={pending}
              onClick={() => mutate('DELETE', g)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Combobox
            items={suggestions}
            inputValue={inputValue}
            onInputValueChange={(v) => setInputValue(v)}
            openOnInputClick
          >
            <ComboboxInput placeholder="Add to a group…" aria-label="Add to group" />
            <ComboboxContent>
              <ComboboxEmpty>Press Add to create this group.</ComboboxEmpty>
              <ComboboxList>
                {(item: string) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        <Button type="button" disabled={pending || !inputValue.trim()} onClick={() => mutate('POST', inputValue)}>
          Add
        </Button>
      </div>
    </div>
  );
}
