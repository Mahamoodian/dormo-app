import { useState } from 'react';
import { get, post, patch, del } from '../../api/client.js';
import { useLoad, useAction, Spinner, ErrorBox, PageHeader, Modal, Field, Empty, Badge, ConfirmModal, MoneyInput } from '../../components/ui.jsx';
import { IconPlus, IconEdit, IconTrash, IconBuilding } from '../../components/icons.jsx';

/** Building → Flat/Dormitory → Area → Bed management */
export default function Properties() {
  const { data, error, loading, reload } = useLoad(() => get('/properties/tree'));
  const [run, busy] = useAction();
  const [modal, setModal] = useState(null); // { type, mode, parent, item, values }
  const [confirm, setConfirm] = useState(null);

  const open = (type, mode, parent, item) => setModal({
    type, mode, parent, item,
    values: item ? { ...item } : type === 'flat' ? { kind: 'dormitory' } : type === 'beds' ? { count: 1, prefix: 'Bed' } : {},
  });
  const set = (k, v) => setModal((m) => ({ ...m, values: { ...m.values, [k]: v } }));

  const save = async (e) => {
    e.preventDefault();
    const { type, mode, parent, item, values: v } = modal;
    const routes = { building: 'buildings', flat: 'flats', area: 'areas', beds: 'beds', bed: 'beds' };
    let body;
    if (type === 'building') body = { name: v.name, address: v.address, notes: v.notes };
    if (type === 'flat') body = { name: v.name, kind: v.kind, notes: v.notes, ...(mode === 'new' ? { building_id: parent.id } : {}) };
    if (type === 'area') body = { name: v.name, ...(mode === 'new' ? { flat_id: parent.id } : {}) };
    if (type === 'beds') body = { area_id: parent.id, count: Number(v.count), prefix: v.prefix, label: Number(v.count) === 1 ? v.label : undefined, default_rent: v.default_rent || null };
    if (type === 'bed') body = { label: v.label, default_rent: v.default_rent === '' ? null : v.default_rent, in_service: v.in_service };
    await run(() => (mode === 'new' ? post(`/properties/${routes[type]}`, body) : patch(`/properties/${routes[type]}/${item.id}`, body)), 'Saved');
    setModal(null);
    reload();
  };

  const remove = async () => {
    const routes = { building: 'buildings', flat: 'flats', area: 'areas', bed: 'beds' };
    await run(() => del(`/properties/${routes[confirm.type]}/${confirm.item.id}`), 'Deleted');
    setConfirm(null);
    reload();
  };

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const titles = { building: 'Building', flat: 'Flat / Dormitory', area: 'Area / Room', beds: 'Add beds', bed: 'Bed' };

  const Actions = ({ type, item }) => (
    <div className="flex shrink-0 gap-1">
      <button className="btn-ghost min-h-[36px] p-2" aria-label="Edit" onClick={() => open(type, 'edit', null, item)}><IconEdit className="h-4 w-4" /></button>
      <button className="btn-ghost min-h-[36px] p-2 text-rose-600" aria-label="Delete" onClick={() => setConfirm({ type, item })}><IconTrash className="h-4 w-4" /></button>
    </div>
  );

  return (
    <>
      <PageHeader title="Properties" subtitle="Building › Flat / Dormitory › Area › Bed"
        actions={<button className="btn-primary" onClick={() => open('building', 'new')}><IconPlus />Building</button>} />

      {!data.buildings.length && (
        <Empty title="No buildings yet" action={<button className="btn-primary" onClick={() => open('building', 'new')}><IconBuilding />Add building</button>}>
          Start by adding a building. Then add flats or dormitories inside it.
        </Empty>
      )}

      <div className="space-y-4">
        {data.buildings.map((b) => (
          <section key={b.id} className="card overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate font-semibold">{b.name}</h2>
                {b.address && <p className="truncate text-xs text-slate-500">{b.address}</p>}
              </div>
              <div className="flex items-center gap-1">
                <button className="btn-secondary min-h-[36px] px-3 text-xs" onClick={() => open('flat', 'new', b)}><IconPlus className="h-4 w-4" />Flat</button>
                <Actions type="building" item={b} />
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {!b.flats.length && <p className="px-4 py-4 text-sm text-slate-500">No flats or dormitories yet.</p>}
              {b.flats.map((f) => (
                <div key={f.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-semibold">{f.name}</span>
                      <Badge color={f.kind === 'dormitory' ? 'blue' : 'slate'}>{f.kind === 'dormitory' ? 'Dormitory' : 'Flat'}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <button className="btn-secondary min-h-[36px] px-3 text-xs" onClick={() => open('area', 'new', f)}><IconPlus className="h-4 w-4" />Area</button>
                      <Actions type="flat" item={f} />
                    </div>
                  </div>
                  <div className="mt-2 space-y-2 border-l-2 border-slate-100 pl-3">
                    {!f.areas.length && <p className="text-xs text-slate-500">Add an area (e.g. Room A, Hall, Partition 1) to create beds.</p>}
                    {f.areas.map((a) => (
                      <div key={a.id} className="rounded-xl bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{a.name} <span className="font-normal text-slate-500">· {a.beds.length} bed(s)</span></span>
                          <div className="flex items-center gap-1">
                            <button className="btn-secondary min-h-[34px] px-2.5 text-xs" onClick={() => open('beds', 'new', a)}><IconPlus className="h-4 w-4" />Beds</button>
                            <Actions type="area" item={a} />
                          </div>
                        </div>
                        {!!a.beds.length && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {a.beds.map((bd) => (
                              <button key={bd.id} onClick={() => open('bed', 'edit', null, bd)}
                                className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                                  bd.status === 'available' ? 'border-emerald-200 bg-white text-emerald-700'
                                    : bd.status === 'maintenance' ? 'border-amber-200 bg-amber-50 text-amber-800'
                                      : bd.status === 'overdue' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-brand-200 bg-brand-50 text-brand-800'}`}>
                                {bd.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} size="sm"
        title={modal ? `${modal.mode === 'new' && modal.type !== 'beds' ? 'New ' : ''}${titles[modal.type]}` : ''}
        subtitle={modal?.parent ? `in ${modal.parent.name}` : undefined}
        footer={<>
          {modal?.type === 'bed' && <button type="button" className="btn-ghost text-rose-600" onClick={() => { setConfirm({ type: 'bed', item: modal.item }); setModal(null); }}>Delete</button>}
          <button className="btn-secondary flex-1" onClick={() => setModal(null)}>Cancel</button>
          <button className="btn-primary flex-1" form="propForm" disabled={busy}>Save</button>
        </>}>
        {modal && (
          <form id="propForm" onSubmit={save} className="space-y-4">
            {['building', 'flat', 'area'].includes(modal.type) && (
              <Field label="Name"><input className="input" required autoFocus value={modal.values.name || ''} onChange={(e) => set('name', e.target.value)}
                placeholder={{ building: 'e.g. Al Noor Tower', flat: 'e.g. Flat 304', area: 'e.g. Room A / Partition 1' }[modal.type]} /></Field>
            )}
            {modal.type === 'building' && (
              <Field label="Address"><input className="input" value={modal.values.address || ''} onChange={(e) => set('address', e.target.value)} /></Field>
            )}
            {modal.type === 'flat' && (
              <Field label="Type">
                <div className="grid grid-cols-2 gap-2">
                  {[['flat', 'Flat'], ['dormitory', 'Dormitory']].map(([k, l]) => (
                    <button type="button" key={k} onClick={() => set('kind', k)}
                      className={`btn border ${modal.values.kind === k ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300 bg-white text-slate-600'}`}>{l}</button>
                  ))}
                </div>
              </Field>
            )}
            {modal.type === 'beds' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="How many beds"><input className="input" type="number" min="1" max="100" required value={modal.values.count} onChange={(e) => set('count', e.target.value)} /></Field>
                  <Field label="Default rent"><MoneyInput value={modal.values.default_rent} onChange={(v) => set('default_rent', v)} placeholder="Optional" /></Field>
                </div>
                {Number(modal.values.count) === 1
                  ? <Field label="Bed label" hint="Leave empty to auto-number"><input className="input" value={modal.values.label || ''} onChange={(e) => set('label', e.target.value)} placeholder="e.g. Lower bunk 1" /></Field>
                  : <Field label="Label prefix" hint={`Creates "${modal.values.prefix || 'Bed'} 1", "${modal.values.prefix || 'Bed'} 2", …`}>
                      <input className="input" value={modal.values.prefix} onChange={(e) => set('prefix', e.target.value)} /></Field>}
              </>
            )}
            {modal.type === 'bed' && (
              <>
                <Field label="Bed label"><input className="input" required value={modal.values.label || ''} onChange={(e) => set('label', e.target.value)} /></Field>
                <Field label="Default rent"><MoneyInput value={modal.values.default_rent} onChange={(v) => set('default_rent', v)} /></Field>
                <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-3">
                  <span className="text-sm font-medium">Under maintenance (not assignable)</span>
                  <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={!modal.values.in_service}
                    disabled={!!modal.item.assignment_id} onChange={(e) => set('in_service', !e.target.checked)} />
                </label>
                {modal.item.assignment_id && <p className="text-xs text-slate-500">Occupied by {modal.item.client_name}.</p>}
              </>
            )}
          </form>
        )}
      </Modal>

      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} onConfirm={remove} busy={busy} danger confirmLabel="Delete"
        title={`Delete ${confirm ? titles[confirm.type].toLowerCase() : ''}?`}
        message={`"${confirm?.item.name || confirm?.item.label}" and everything inside it will be removed. Items with tenancy history or expenses cannot be deleted.`} />
    </>
  );
}
