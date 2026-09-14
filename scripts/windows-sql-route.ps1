# Ruta SQL para desarrollo en Wi-Fi (sin depender del cable Ethernet).
# En oficina: el Wi-Fi (192.168.40.x) no llega a SQL (192.168.10.3) por defecto.
# Este script envía ese tráfico por el gateway de la red cableada (192.168.11.11).
# Ejecutar PowerShell COMO ADMINISTRADOR.

$ErrorActionPreference = 'Stop'

$network = if ($env:DATABASE_ROUTE_NETWORK) { $env:DATABASE_ROUTE_NETWORK } else { '192.168.10.0' }
$mask = if ($env:DATABASE_ROUTE_MASK) { $env:DATABASE_ROUTE_MASK } else { '255.255.255.0' }
$gateway = if ($env:DATABASE_ROUTE_GATEWAY) { $env:DATABASE_ROUTE_GATEWAY } else { '192.168.11.11' }

Write-Host "Agregando ruta: $network / $mask -> $gateway"

route delete $network mask $mask $gateway 2>$null | Out-Null
route add $network mask $mask $gateway metric 1

Write-Host "Listo. Prueba: npm run test:db"
