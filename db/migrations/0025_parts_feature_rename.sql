-- The module is now called "Venda de Peças" (it was created as "Controle de Peças").
UPDATE features
SET name = 'Venda de Peças',
    description = 'Estoque de peças em consignação com os técnicos, venda pelo celular com Mercado Pago, inventário, acerto mensal e financeiro.'
WHERE key = 'parts';
