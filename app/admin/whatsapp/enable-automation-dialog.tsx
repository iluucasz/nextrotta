'use client';

import { useEffect, useState } from 'react';
import { Power } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  NOTIFICATION_DEFINITIONS,
  NOTIFICATION_TYPES,
  type NotificationSettings,
  type NotificationType,
} from '@/lib/whatsapp/notification-types';

interface EnableAutomationDialogProps {
  open: boolean;
  notifications: NotificationSettings;
  onCancel: () => void;
  /** Turns the automation on with exactly these notifications enabled. */
  onConfirm: (enabled: NotificationType[]) => void;
}

/**
 * Turning the automation on asks which notifications go with it: all of them, or only some.
 * Without this, the master switch could be on while every notification stays off.
 */
export function EnableAutomationDialog({ open, notifications, onCancel, onConfirm }: EnableAutomationDialogProps) {
  const [selected, setSelected] = useState<Set<NotificationType>>(new Set());

  // Each time it opens: what's already on, or everything when nothing is.
  useEffect(() => {
    if (!open) return;
    const alreadyOn = NOTIFICATION_TYPES.filter((type) => notifications[type].enabled);
    setSelected(new Set(alreadyOn.length ? alreadyOn : NOTIFICATION_TYPES));
  }, [open, notifications]);

  function toggle(type: NotificationType, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(type);
      else next.delete(type);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Power className="h-5 w-5 text-emerald-600" />
            Ligar a automação do WhatsApp
          </DialogTitle>
          <DialogDescription>Quais notificações devem ser enviadas automaticamente para os técnicos?</DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          {NOTIFICATION_TYPES.map((type) => {
            const definition = NOTIFICATION_DEFINITIONS[type];
            const id = `automation-${type}`;
            return (
              <label
                key={type}
                htmlFor={id}
                className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 hover:bg-secondary/60"
              >
                <Checkbox
                  id={id}
                  className="mt-0.5"
                  checked={selected.has(type)}
                  onCheckedChange={(checked) => toggle(type, checked === true)}
                />
                <span className="text-sm leading-snug">
                  <span className="block font-medium">{definition.label}</span>
                  <span className="block text-xs text-muted-foreground">{definition.description}</span>
                </span>
              </label>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Horários e textos de cada uma ficam na aba Notificações, e dá para ligar ou desligar cada notificação por lá depois.
        </p>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={!selected.size} onClick={() => onConfirm([...selected])}>
              Ativar selecionadas ({selected.size})
            </Button>
            <Button type="button" onClick={() => onConfirm([...NOTIFICATION_TYPES])}>
              Ativar todas
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
