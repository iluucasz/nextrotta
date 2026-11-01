'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Panel } from '@/components/management-ui';
import { Button } from '@/components/ui/button';
import { useSettingsForm } from '@/components/settings/form';
import { NumberField, SettingsPage } from '@/components/settings/kit';

export default function FinanceiroPage() {
  const api = useSettingsForm('finance');
  const { form, update } = api;
  const [category, setCategory] = useState('');
  const [duplicate, setDuplicate] = useState('');

  function add() {
    const name = category.trim();
    if (!name) return;
    if (form.financeCategories.some((existing) => existing.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
      setDuplicate(`A categoria "${name}" já existe.`);
      return;
    }
    update('financeCategories', [...form.financeCategories, name]);
    setCategory('');
    setDuplicate('');
  }

  return (
    <SettingsPage api={api} title="Financeiro" description="Regras do controle de despesas.">
      <div className="st-grid-two">
        <Panel title="Vencimentos" help="Contas que vencem dentro deste prazo aparecem como “vence em breve” no controle de despesas.">
          <div className="st-fields">
            <NumberField id="due-soon" label="Aviso de vencimento" unit="dias" value={form.financeDueSoonDays} onChange={(value) => update('financeDueSoonDays', value)} />
          </div>
        </Panel>

        <Panel title="Categorias de despesa" help="Sugestões ao lançar uma despesa; o campo continua aceitando outra categoria. As despesas já lançadas mantêm a categoria.">
          <div className="st-chips">
            {form.financeCategories.map((name) => (
              <span key={name} className="st-chip">
                {name}
                <button type="button" aria-label={`Remover categoria ${name}`} onClick={() => update('financeCategories', form.financeCategories.filter((item) => item !== name))}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
          <div className="st-add">
            <div className="st-input">
              <input
                type="text"
                aria-label="Nova categoria"
                value={category}
                placeholder="Nova categoria"
                onChange={(event) => {
                  setCategory(event.target.value);
                  setDuplicate('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    add();
                  }
                }}
              />
            </div>
            <Button type="button" variant="outline" onClick={add} className="h-11">
              <Plus className="h-4 w-4" />
              Adicionar
            </Button>
          </div>
          {duplicate ? (
            <p className="st-preview" role="alert">
              {duplicate}
            </p>
          ) : null}
        </Panel>
      </div>
    </SettingsPage>
  );
}
