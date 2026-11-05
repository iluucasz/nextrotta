'use client';
import { createContext, useContext } from 'react';

/** Who is using the panel: the owner, or a support user ("atendente") with a smaller panel. The API enforces it too. */
export type PanelRole = 'platform_owner' | 'platform_support';

const RoleContext = createContext<PanelRole>('platform_owner');

export const PanelRoleProvider = RoleContext.Provider;
export const usePanelRole = () => useContext(RoleContext);
export const useIsOwner = () => useContext(RoleContext) === 'platform_owner';
