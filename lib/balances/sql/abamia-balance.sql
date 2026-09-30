-- Replica (plantilla GSS) — equivalente al paso 'Balance_Abamia_2026' del SQL Server Agent Job compartido
-- (Balance_Empresas / Balance_Acumulado_Empresas) NO existe aun en el job de serfarma07 (192.168.10.7), 2026-09-21.
-- Ejecutar contra la base FARMA_IND_PROD. NO modificar sin revisar el job original.

DELETE FROM [dbo].[Abm_Balance_2026]
INSERT INTO [dbo].[Abm_Balance_2026]
           ([Cuenta]
			,[Nombre_cuenta]
			,[NIT]
			,[Nombre_SN]
			,[Serie]
			,[Numero]
			,[Linea]
			,[RefBase]
			,[Ref_1]
			,[Ref_2]
			,[Debito]
			,[Credito]
			,[Detalles]
			,[Fecha_Cont]
			,[Fecha_Ven]
			,[Fecha_Doc]
			,[Proyecto]
			,[Norma]
			,[Codigo_Indicador])
SELECT T1.[Account], T2.[AcctName], T3.LicTradNum, T3.[CardName],--, T1.[Project], 
	   T0.[Series], T0.[TransId], T1.[Line_ID], T1.[BaseRef], T1.[Ref1], T0.[Ref2], 
	   T1.[Debit], T1.[Credit], T1.[LineMemo], T1.[RefDate], T1.[DueDate], T1.[TaxDate], 
	   T1.[Project], T1.[ProfitCode], T1.[U_HBT_Impuesto]
	   --T1.[U_HBT_Base], T1.[U_HBT_TarRet], 
	   --T1.[U_HBT_ConcepMM] 
FROM [ABAMIA_PROD].DBO.OJDT T0  INNER JOIN [ABAMIA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [ABAMIA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [ABAMIA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <= '2026/31/12' and T0.U_HBT_AreVal <> 'local'
