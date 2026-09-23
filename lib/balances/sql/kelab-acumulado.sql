-- Replica (plantilla GSS) — equivalente al paso 'Balance_Acumulado_Kelab_2026' del SQL Server Agent Job compartido
-- (Balance_Empresas / Balance_Acumulado_Empresas) NO existe aun en el job de serfarma07 (192.168.10.7), 2026-09-21.
-- Ejecutar contra la base FARMA_IND_PROD. NO modificar sin revisar el job original.

DELETE FROM [dbo].[Kel_Balance_Acumulado_2026]

INSERT INTO [dbo].[Kel_Balance_Acumulado_2026] ([Cuenta],[Nombre],[Mes],[Valor])
SELECT TOP (100) PERCENT  T72.AcctCode AS Cuenta_5, T72.AcctName AS [Nombre], 'ENERO' as 'MES', SUM(T9.SI) AS [saldo_Inicial]
FROM            (SELECT        CASE WHEN T2.levels = 5 THEN T2.AcctCode ELSE T2.AcctCode END AS Cuenta_5,
							   T1.RefDate AS Fecha, MONTH(T1.RefDate) AS mes, YEAR(T1.RefDate) AS año, 
                               SUM(ISNULL(T1.Debit, 0) - ISNULL(T1.Credit, 0)) AS SI, T0.TransType
                          FROM     [KELAB_ANALITICA_PROD].DBO.OJDT AS T0 INNER JOIN
                                   [KELAB_ANALITICA_PROD].DBO.JDT1 AS T1 ON T0.TransId = T1.TransId INNER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA1) AS T2 ON T2.AcctCode = T1.Account LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA2) AS T3 ON T3.AcctCode = T2.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA3) AS T4 ON T4.AcctCode = T3.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA4) AS T5 ON T5.AcctCode = T4.FatherNum LEFT OUTER JOIN
									   (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T6 ON T6.AcctCode = T5.FatherNum
						 
						 
						 WHERE T0.U_HBT_AreVal <> 'Local' and T1.Account < 30000000
                         GROUP BY T0.TransType, T2.FatherNum, T3.FatherNum, T2.Levels, T3.Levels, 
						           T2.AcctCode, T4.FatherNum, T3.AcctCode, T5.FatherNum, T1.RefDate, MONTH(T1.RefDate)) AS T9 INNER JOIN
                             (SELECT        AcctCode, AcctName
                               FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T72 ON T72.AcctCode = T9.Cuenta_5

WHERE T9.Fecha <='2026/31/01'
GROUP BY T72.AcctCode, T72.AcctName
ORDER BY Cuenta_5 

INSERT INTO [dbo].[Kel_Balance_Acumulado_2026] ([Cuenta],[Nombre],[Mes],[Valor])
SELECT TOP (100) PERCENT  T72.AcctCode AS Cuenta_5, T72.AcctName AS [Nombre], 'FEBRERO' as 'MES', SUM(T9.SI) AS [saldo_Inicial]
FROM            (SELECT        CASE WHEN T2.levels = 5 THEN T2.AcctCode ELSE T2.AcctCode END AS Cuenta_5,
							   T1.RefDate AS Fecha, MONTH(T1.RefDate) AS mes, YEAR(T1.RefDate) AS año, 
                               SUM(ISNULL(T1.Debit, 0) - ISNULL(T1.Credit, 0)) AS SI, T0.TransType
                          FROM     [KELAB_ANALITICA_PROD].DBO.OJDT AS T0 INNER JOIN
                                   [KELAB_ANALITICA_PROD].DBO.JDT1 AS T1 ON T0.TransId = T1.TransId INNER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA1) AS T2 ON T2.AcctCode = T1.Account LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA2) AS T3 ON T3.AcctCode = T2.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA3) AS T4 ON T4.AcctCode = T3.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA4) AS T5 ON T5.AcctCode = T4.FatherNum LEFT OUTER JOIN
									   (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T6 ON T6.AcctCode = T5.FatherNum
						 
						 
						 WHERE T0.U_HBT_AreVal <> 'Local' and T1.Account < 30000000
                         GROUP BY T0.TransType, T2.FatherNum, T3.FatherNum, T2.Levels, T3.Levels, 
						           T2.AcctCode, T4.FatherNum, T3.AcctCode, T5.FatherNum, T1.RefDate, MONTH(T1.RefDate)) AS T9 INNER JOIN
                             (SELECT        AcctCode, AcctName
                               FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T72 ON T72.AcctCode = T9.Cuenta_5

WHERE T9.Fecha <='2026/28/02'
GROUP BY T72.AcctCode, T72.AcctName
ORDER BY Cuenta_5 

INSERT INTO [dbo].[Kel_Balance_Acumulado_2026] ([Cuenta],[Nombre],[Mes],[Valor])
SELECT TOP (100) PERCENT  T72.AcctCode AS Cuenta_5, T72.AcctName AS [Nombre], 'MARZO' as 'MES', SUM(T9.SI) AS [saldo_Inicial]
FROM            (SELECT        CASE WHEN T2.levels = 5 THEN T2.AcctCode ELSE T2.AcctCode END AS Cuenta_5,
							   T1.RefDate AS Fecha, MONTH(T1.RefDate) AS mes, YEAR(T1.RefDate) AS año, 
                               SUM(ISNULL(T1.Debit, 0) - ISNULL(T1.Credit, 0)) AS SI, T0.TransType
                          FROM     [KELAB_ANALITICA_PROD].DBO.OJDT AS T0 INNER JOIN
                                   [KELAB_ANALITICA_PROD].DBO.JDT1 AS T1 ON T0.TransId = T1.TransId INNER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA1) AS T2 ON T2.AcctCode = T1.Account LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA2) AS T3 ON T3.AcctCode = T2.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA3) AS T4 ON T4.AcctCode = T3.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA4) AS T5 ON T5.AcctCode = T4.FatherNum LEFT OUTER JOIN
									   (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T6 ON T6.AcctCode = T5.FatherNum
						 
						 
						 WHERE T0.U_HBT_AreVal <> 'Local' and T1.Account < 30000000
                         GROUP BY T0.TransType, T2.FatherNum, T3.FatherNum, T2.Levels, T3.Levels, 
						           T2.AcctCode, T4.FatherNum, T3.AcctCode, T5.FatherNum, T1.RefDate, MONTH(T1.RefDate)) AS T9 INNER JOIN
                             (SELECT        AcctCode, AcctName
                               FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T72 ON T72.AcctCode = T9.Cuenta_5

WHERE T9.Fecha <='2026/31/03'
GROUP BY T72.AcctCode, T72.AcctName
ORDER BY Cuenta_5 

INSERT INTO [dbo].[Kel_Balance_Acumulado_2026] ([Cuenta],[Nombre],[Mes],[Valor])
SELECT TOP (100) PERCENT  T72.AcctCode AS Cuenta_5, T72.AcctName AS [Nombre], 'ABRIL' as 'MES', SUM(T9.SI) AS [saldo_Inicial]
FROM            (SELECT        CASE WHEN T2.levels = 5 THEN T2.AcctCode ELSE T2.AcctCode END AS Cuenta_5,
							   T1.RefDate AS Fecha, MONTH(T1.RefDate) AS mes, YEAR(T1.RefDate) AS año, 
                               SUM(ISNULL(T1.Debit, 0) - ISNULL(T1.Credit, 0)) AS SI, T0.TransType
                          FROM     [KELAB_ANALITICA_PROD].DBO.OJDT AS T0 INNER JOIN
                                   [KELAB_ANALITICA_PROD].DBO.JDT1 AS T1 ON T0.TransId = T1.TransId INNER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA1) AS T2 ON T2.AcctCode = T1.Account LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA2) AS T3 ON T3.AcctCode = T2.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA3) AS T4 ON T4.AcctCode = T3.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA4) AS T5 ON T5.AcctCode = T4.FatherNum LEFT OUTER JOIN
									   (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T6 ON T6.AcctCode = T5.FatherNum
						 
						 
						 WHERE T0.U_HBT_AreVal <> 'Local' and T1.Account < 30000000
                         GROUP BY T0.TransType, T2.FatherNum, T3.FatherNum, T2.Levels, T3.Levels, 
						           T2.AcctCode, T4.FatherNum, T3.AcctCode, T5.FatherNum, T1.RefDate, MONTH(T1.RefDate)) AS T9 INNER JOIN
                             (SELECT        AcctCode, AcctName
                               FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T72 ON T72.AcctCode = T9.Cuenta_5

WHERE T9.Fecha <='2026/30/04'
GROUP BY T72.AcctCode, T72.AcctName
ORDER BY Cuenta_5 

INSERT INTO [dbo].[Kel_Balance_Acumulado_2026] ([Cuenta],[Nombre],[Mes],[Valor])
SELECT TOP (100) PERCENT  T72.AcctCode AS Cuenta_5, T72.AcctName AS [Nombre], 'MAYO' as 'MES', SUM(T9.SI) AS [saldo_Inicial]
FROM            (SELECT        CASE WHEN T2.levels = 5 THEN T2.AcctCode ELSE T2.AcctCode END AS Cuenta_5,
							   T1.RefDate AS Fecha, MONTH(T1.RefDate) AS mes, YEAR(T1.RefDate) AS año, 
                               SUM(ISNULL(T1.Debit, 0) - ISNULL(T1.Credit, 0)) AS SI, T0.TransType
                          FROM     [KELAB_ANALITICA_PROD].DBO.OJDT AS T0 INNER JOIN
                                   [KELAB_ANALITICA_PROD].DBO.JDT1 AS T1 ON T0.TransId = T1.TransId INNER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA1) AS T2 ON T2.AcctCode = T1.Account LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA2) AS T3 ON T3.AcctCode = T2.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA3) AS T4 ON T4.AcctCode = T3.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA4) AS T5 ON T5.AcctCode = T4.FatherNum LEFT OUTER JOIN
									   (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T6 ON T6.AcctCode = T5.FatherNum
						 
						 
						 WHERE T0.U_HBT_AreVal <> 'Local' and T1.Account < 30000000
                         GROUP BY T0.TransType, T2.FatherNum, T3.FatherNum, T2.Levels, T3.Levels, 
						           T2.AcctCode, T4.FatherNum, T3.AcctCode, T5.FatherNum, T1.RefDate, MONTH(T1.RefDate)) AS T9 INNER JOIN
                             (SELECT        AcctCode, AcctName
                               FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T72 ON T72.AcctCode = T9.Cuenta_5

WHERE T9.Fecha <='2026/31/05'
GROUP BY T72.AcctCode, T72.AcctName
ORDER BY Cuenta_5 

INSERT INTO [dbo].[Kel_Balance_Acumulado_2026] ([Cuenta],[Nombre],[Mes],[Valor])
SELECT TOP (100) PERCENT  T72.AcctCode AS Cuenta_5, T72.AcctName AS [Nombre], 'JUNIO' as 'MES', SUM(T9.SI) AS [saldo_Inicial]
FROM            (SELECT        CASE WHEN T2.levels = 5 THEN T2.AcctCode ELSE T2.AcctCode END AS Cuenta_5,
							   T1.RefDate AS Fecha, MONTH(T1.RefDate) AS mes, YEAR(T1.RefDate) AS año, 
                               SUM(ISNULL(T1.Debit, 0) - ISNULL(T1.Credit, 0)) AS SI, T0.TransType
                          FROM     [KELAB_ANALITICA_PROD].DBO.OJDT AS T0 INNER JOIN
                                   [KELAB_ANALITICA_PROD].DBO.JDT1 AS T1 ON T0.TransId = T1.TransId INNER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA1) AS T2 ON T2.AcctCode = T1.Account LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA2) AS T3 ON T3.AcctCode = T2.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA3) AS T4 ON T4.AcctCode = T3.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA4) AS T5 ON T5.AcctCode = T4.FatherNum LEFT OUTER JOIN
									   (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T6 ON T6.AcctCode = T5.FatherNum
						 
						 
						 WHERE T0.U_HBT_AreVal <> 'Local' and T1.Account < 30000000
                         GROUP BY T0.TransType, T2.FatherNum, T3.FatherNum, T2.Levels, T3.Levels, 
						           T2.AcctCode, T4.FatherNum, T3.AcctCode, T5.FatherNum, T1.RefDate, MONTH(T1.RefDate)) AS T9 INNER JOIN
                             (SELECT        AcctCode, AcctName
                               FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T72 ON T72.AcctCode = T9.Cuenta_5

WHERE T9.Fecha <='2026/30/06'
GROUP BY T72.AcctCode, T72.AcctName
ORDER BY Cuenta_5 

INSERT INTO [dbo].[Kel_Balance_Acumulado_2026] ([Cuenta],[Nombre],[Mes],[Valor])
SELECT TOP (100) PERCENT  T72.AcctCode AS Cuenta_5, T72.AcctName AS [Nombre], 'JULIO' as 'MES', SUM(T9.SI) AS [saldo_Inicial]
FROM            (SELECT        CASE WHEN T2.levels = 5 THEN T2.AcctCode ELSE T2.AcctCode END AS Cuenta_5,
							   T1.RefDate AS Fecha, MONTH(T1.RefDate) AS mes, YEAR(T1.RefDate) AS año, 
                               SUM(ISNULL(T1.Debit, 0) - ISNULL(T1.Credit, 0)) AS SI, T0.TransType
                          FROM     [KELAB_ANALITICA_PROD].DBO.OJDT AS T0 INNER JOIN
                                   [KELAB_ANALITICA_PROD].DBO.JDT1 AS T1 ON T0.TransId = T1.TransId INNER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA1) AS T2 ON T2.AcctCode = T1.Account LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA2) AS T3 ON T3.AcctCode = T2.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA3) AS T4 ON T4.AcctCode = T3.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA4) AS T5 ON T5.AcctCode = T4.FatherNum LEFT OUTER JOIN
									   (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T6 ON T6.AcctCode = T5.FatherNum
						 
						 
						 WHERE T0.U_HBT_AreVal <> 'Local' and T1.Account < 30000000
                         GROUP BY T0.TransType, T2.FatherNum, T3.FatherNum, T2.Levels, T3.Levels, 
						           T2.AcctCode, T4.FatherNum, T3.AcctCode, T5.FatherNum, T1.RefDate, MONTH(T1.RefDate)) AS T9 INNER JOIN
                             (SELECT        AcctCode, AcctName
                               FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T72 ON T72.AcctCode = T9.Cuenta_5

WHERE T9.Fecha <='2026/31/07'
GROUP BY T72.AcctCode, T72.AcctName
ORDER BY Cuenta_5 


INSERT INTO [dbo].[Kel_Balance_Acumulado_2026] ([Cuenta],[Nombre],[Mes],[Valor])
SELECT TOP (100) PERCENT  T72.AcctCode AS Cuenta_5, T72.AcctName AS [Nombre], 'AGOSTO' as 'MES', SUM(T9.SI) AS [saldo_Inicial]
FROM            (SELECT        CASE WHEN T2.levels = 5 THEN T2.AcctCode ELSE T2.AcctCode END AS Cuenta_5,
							   T1.RefDate AS Fecha, MONTH(T1.RefDate) AS mes, YEAR(T1.RefDate) AS año, 
                               SUM(ISNULL(T1.Debit, 0) - ISNULL(T1.Credit, 0)) AS SI, T0.TransType
                          FROM     [KELAB_ANALITICA_PROD].DBO.OJDT AS T0 INNER JOIN
                                   [KELAB_ANALITICA_PROD].DBO.JDT1 AS T1 ON T0.TransId = T1.TransId INNER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA1) AS T2 ON T2.AcctCode = T1.Account LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA2) AS T3 ON T3.AcctCode = T2.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA3) AS T4 ON T4.AcctCode = T3.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA4) AS T5 ON T5.AcctCode = T4.FatherNum LEFT OUTER JOIN
									   (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T6 ON T6.AcctCode = T5.FatherNum
						 
						 
						 WHERE T0.U_HBT_AreVal <> 'Local' and T1.Account < 30000000
                         GROUP BY T0.TransType, T2.FatherNum, T3.FatherNum, T2.Levels, T3.Levels, 
						           T2.AcctCode, T4.FatherNum, T3.AcctCode, T5.FatherNum, T1.RefDate, MONTH(T1.RefDate)) AS T9 INNER JOIN
                             (SELECT        AcctCode, AcctName
                               FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T72 ON T72.AcctCode = T9.Cuenta_5

WHERE T9.Fecha <='2026/31/08'
GROUP BY T72.AcctCode, T72.AcctName
ORDER BY Cuenta_5 

INSERT INTO [dbo].[Kel_Balance_Acumulado_2026] ([Cuenta],[Nombre],[Mes],[Valor])
SELECT TOP (100) PERCENT  T72.AcctCode AS Cuenta_5, T72.AcctName AS [Nombre], 'SEPTIEMBRE' as 'MES', SUM(T9.SI) AS [saldo_Inicial]
FROM            (SELECT        CASE WHEN T2.levels = 5 THEN T2.AcctCode ELSE T2.AcctCode END AS Cuenta_5,
							   T1.RefDate AS Fecha, MONTH(T1.RefDate) AS mes, YEAR(T1.RefDate) AS año, 
                               SUM(ISNULL(T1.Debit, 0) - ISNULL(T1.Credit, 0)) AS SI, T0.TransType
                          FROM     [KELAB_ANALITICA_PROD].DBO.OJDT AS T0 INNER JOIN
                                   [KELAB_ANALITICA_PROD].DBO.JDT1 AS T1 ON T0.TransId = T1.TransId INNER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA1) AS T2 ON T2.AcctCode = T1.Account LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA2) AS T3 ON T3.AcctCode = T2.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA3) AS T4 ON T4.AcctCode = T3.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA4) AS T5 ON T5.AcctCode = T4.FatherNum LEFT OUTER JOIN
									   (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T6 ON T6.AcctCode = T5.FatherNum
						 
						 
						 WHERE T0.U_HBT_AreVal <> 'Local' and T1.Account < 30000000
                         GROUP BY T0.TransType, T2.FatherNum, T3.FatherNum, T2.Levels, T3.Levels, 
						           T2.AcctCode, T4.FatherNum, T3.AcctCode, T5.FatherNum, T1.RefDate, MONTH(T1.RefDate)) AS T9 INNER JOIN
                             (SELECT        AcctCode, AcctName
                               FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T72 ON T72.AcctCode = T9.Cuenta_5

WHERE T9.Fecha <='2026/30/09'
GROUP BY T72.AcctCode, T72.AcctName
ORDER BY Cuenta_5 

INSERT INTO [dbo].[Kel_Balance_Acumulado_2026] ([Cuenta],[Nombre],[Mes],[Valor])
SELECT TOP (100) PERCENT  T72.AcctCode AS Cuenta_5, T72.AcctName AS [Nombre], 'OCTUBRE' as 'MES', SUM(T9.SI) AS [saldo_Inicial]
FROM            (SELECT        CASE WHEN T2.levels = 5 THEN T2.AcctCode ELSE T2.AcctCode END AS Cuenta_5,
							   T1.RefDate AS Fecha, MONTH(T1.RefDate) AS mes, YEAR(T1.RefDate) AS año, 
                               SUM(ISNULL(T1.Debit, 0) - ISNULL(T1.Credit, 0)) AS SI, T0.TransType
                          FROM     [KELAB_ANALITICA_PROD].DBO.OJDT AS T0 INNER JOIN
                                   [KELAB_ANALITICA_PROD].DBO.JDT1 AS T1 ON T0.TransId = T1.TransId INNER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA1) AS T2 ON T2.AcctCode = T1.Account LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA2) AS T3 ON T3.AcctCode = T2.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA3) AS T4 ON T4.AcctCode = T3.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA4) AS T5 ON T5.AcctCode = T4.FatherNum LEFT OUTER JOIN
									   (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T6 ON T6.AcctCode = T5.FatherNum
						 
						 
						 WHERE T0.U_HBT_AreVal <> 'Local' and T1.Account < 30000000
                         GROUP BY T0.TransType, T2.FatherNum, T3.FatherNum, T2.Levels, T3.Levels, 
						           T2.AcctCode, T4.FatherNum, T3.AcctCode, T5.FatherNum, T1.RefDate, MONTH(T1.RefDate)) AS T9 INNER JOIN
                             (SELECT        AcctCode, AcctName
                               FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T72 ON T72.AcctCode = T9.Cuenta_5

WHERE T9.Fecha <='2026/31/10'
GROUP BY T72.AcctCode, T72.AcctName
ORDER BY Cuenta_5 

INSERT INTO [dbo].[Kel_Balance_Acumulado_2026] ([Cuenta],[Nombre],[Mes],[Valor])
SELECT TOP (100) PERCENT  T72.AcctCode AS Cuenta_5, T72.AcctName AS [Nombre], 'NOVIEMBRE' as 'MES', SUM(T9.SI) AS [saldo_Inicial]
FROM            (SELECT        CASE WHEN T2.levels = 5 THEN T2.AcctCode ELSE T2.AcctCode END AS Cuenta_5,
							   T1.RefDate AS Fecha, MONTH(T1.RefDate) AS mes, YEAR(T1.RefDate) AS año, 
                               SUM(ISNULL(T1.Debit, 0) - ISNULL(T1.Credit, 0)) AS SI, T0.TransType
                          FROM     [KELAB_ANALITICA_PROD].DBO.OJDT AS T0 INNER JOIN
                                   [KELAB_ANALITICA_PROD].DBO.JDT1 AS T1 ON T0.TransId = T1.TransId INNER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA1) AS T2 ON T2.AcctCode = T1.Account LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA2) AS T3 ON T3.AcctCode = T2.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA3) AS T4 ON T4.AcctCode = T3.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA4) AS T5 ON T5.AcctCode = T4.FatherNum LEFT OUTER JOIN
									   (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T6 ON T6.AcctCode = T5.FatherNum
						 
						 
						 WHERE T0.U_HBT_AreVal <> 'Local' and T1.Account < 30000000
                         GROUP BY T0.TransType, T2.FatherNum, T3.FatherNum, T2.Levels, T3.Levels, 
						           T2.AcctCode, T4.FatherNum, T3.AcctCode, T5.FatherNum, T1.RefDate, MONTH(T1.RefDate)) AS T9 INNER JOIN
                             (SELECT        AcctCode, AcctName
                               FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T72 ON T72.AcctCode = T9.Cuenta_5

WHERE T9.Fecha <='2026/30/11'
GROUP BY T72.AcctCode, T72.AcctName
ORDER BY Cuenta_5 

INSERT INTO [dbo].[Kel_Balance_Acumulado_2026] ([Cuenta],[Nombre],[Mes],[Valor])
SELECT TOP (100) PERCENT  T72.AcctCode AS Cuenta_5, T72.AcctName AS [Nombre], 'DICIEMBRE' as 'MES', SUM(T9.SI) AS [saldo_Inicial]
FROM            (SELECT        CASE WHEN T2.levels = 5 THEN T2.AcctCode ELSE T2.AcctCode END AS Cuenta_5,
							   T1.RefDate AS Fecha, MONTH(T1.RefDate) AS mes, YEAR(T1.RefDate) AS año, 
                               SUM(ISNULL(T1.Debit, 0) - ISNULL(T1.Credit, 0)) AS SI, T0.TransType
                          FROM     [KELAB_ANALITICA_PROD].DBO.OJDT AS T0 INNER JOIN
                                   [KELAB_ANALITICA_PROD].DBO.JDT1 AS T1 ON T0.TransId = T1.TransId INNER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA1) AS T2 ON T2.AcctCode = T1.Account LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA2) AS T3 ON T3.AcctCode = T2.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA3) AS T4 ON T4.AcctCode = T3.FatherNum LEFT OUTER JOIN
                                       (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA4) AS T5 ON T5.AcctCode = T4.FatherNum LEFT OUTER JOIN
									   (SELECT        AcctCode, FatherNum, Levels
                                        FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T6 ON T6.AcctCode = T5.FatherNum
						 
						 
						 WHERE T0.U_HBT_AreVal <> 'Local' and T1.Account < 30000000
                         GROUP BY T0.TransType, T2.FatherNum, T3.FatherNum, T2.Levels, T3.Levels, 
						           T2.AcctCode, T4.FatherNum, T3.AcctCode, T5.FatherNum, T1.RefDate, MONTH(T1.RefDate)) AS T9 INNER JOIN
                             (SELECT        AcctCode, AcctName
                               FROM            [KELAB_ANALITICA_PROD].DBO.OACT AS TA5) AS T72 ON T72.AcctCode = T9.Cuenta_5

WHERE T9.Fecha <='2026/31/12'
GROUP BY T72.AcctCode, T72.AcctName
ORDER BY Cuenta_5 


INSERT 
INTO [dbo].[Kel_Balance_Acumulado_2026]([Cuenta], [Nombre], [Mes], [Valor]) 
SELECT T1.[Account], T2.[AcctName],'ENERO' as Mes, Sum(T1.[Debit])- Sum(T1.[Credit]) as Valor
FROM [KELAB_ANALITICA_PROD].DBO.OJDT T0  INNER JOIN [KELAB_ANALITICA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <='2026/31/01' and  T1.Account >= 40000000
GROUP BY T1.[Account], T2.[AcctName]
ORDER BY T1.Account

INSERT 
INTO [dbo].[Kel_Balance_Acumulado_2026]([Cuenta], [Nombre], [Mes], [Valor])
SELECT T1.[Account], T2.[AcctName],'FEBRERO' as Mes, Sum(T1.[Debit])- Sum(T1.[Credit]) as Valor
FROM [KELAB_ANALITICA_PROD].DBO.OJDT T0  INNER JOIN [KELAB_ANALITICA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <='2026/28/02' and  T1.Account >= 40000000
GROUP BY T1.[Account], T2.[AcctName]--, T1.[Debit], T1.[Credit]
ORDER BY T1.Account

INSERT 
INTO [dbo].[Kel_Balance_Acumulado_2026]([Cuenta], [Nombre], [Mes], [Valor])
SELECT T1.[Account], T2.[AcctName],'MARZO' as Mes, Sum(T1.[Debit])- Sum(T1.[Credit]) as Valor
FROM [KELAB_ANALITICA_PROD].DBO.OJDT T0  INNER JOIN [KELAB_ANALITICA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <='2026/31/03' and  T1.Account >= 40000000
GROUP BY T1.[Account], T2.[AcctName]--, T1.[Debit], T1.[Credit]
ORDER BY T1.Account

INSERT 
INTO [dbo].[Kel_Balance_Acumulado_2026]([Cuenta], [Nombre], [Mes], [Valor])
SELECT T1.[Account], T2.[AcctName],'ABRIL' as Mes, Sum(T1.[Debit])- Sum(T1.[Credit]) as Valor
FROM [KELAB_ANALITICA_PROD].DBO.OJDT T0  INNER JOIN [KELAB_ANALITICA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <='2026/30/04' and  T1.Account >= 40000000
GROUP BY T1.[Account], T2.[AcctName]--, T1.[Debit], T1.[Credit]
ORDER BY T1.Account

INSERT 
INTO [dbo].[Kel_Balance_Acumulado_2026]([Cuenta], [Nombre], [Mes], [Valor])
SELECT T1.[Account], T2.[AcctName],'MAYO' as Mes, Sum(T1.[Debit])- Sum(T1.[Credit]) as Valor
FROM [KELAB_ANALITICA_PROD].DBO.OJDT T0  INNER JOIN [KELAB_ANALITICA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <='2026/31/05' and  T1.Account >= 40000000
GROUP BY T1.[Account], T2.[AcctName]--, T1.[Debit], T1.[Credit]
ORDER BY T1.Account

INSERT 
INTO [dbo].[Kel_Balance_Acumulado_2026]([Cuenta], [Nombre], [Mes], [Valor])
SELECT T1.[Account], T2.[AcctName],'JUNIO' as Mes, Sum(T1.[Debit])- Sum(T1.[Credit]) as Valor
FROM [KELAB_ANALITICA_PROD].DBO.OJDT T0  INNER JOIN [KELAB_ANALITICA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <='2026/30/06' and  T1.Account >= 40000000
GROUP BY T1.[Account], T2.[AcctName]--, T1.[Debit], T1.[Credit]
ORDER BY T1.Account

INSERT 
INTO [dbo].[Kel_Balance_Acumulado_2026]([Cuenta], [Nombre], [Mes], [Valor])
SELECT T1.[Account], T2.[AcctName],'JULIO' as Mes, Sum(T1.[Debit])- Sum(T1.[Credit]) as Valor
FROM [KELAB_ANALITICA_PROD].DBO.OJDT T0  INNER JOIN [KELAB_ANALITICA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <='2026/31/07' and  T1.Account >= 40000000
GROUP BY T1.[Account], T2.[AcctName]--, T1.[Debit], T1.[Credit]
ORDER BY T1.Account

INSERT 
INTO [dbo].[Kel_Balance_Acumulado_2026]([Cuenta], [Nombre], [Mes], [Valor])
SELECT T1.[Account], T2.[AcctName],'AGOSTO' as Mes, Sum(T1.[Debit])- Sum(T1.[Credit]) as Valor
FROM [KELAB_ANALITICA_PROD].DBO.OJDT T0  INNER JOIN [KELAB_ANALITICA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <='2026/31/08' and  T1.Account >= 40000000
GROUP BY T1.[Account], T2.[AcctName]--, T1.[Debit], T1.[Credit]
ORDER BY T1.Account

INSERT 
INTO [dbo].[Kel_Balance_Acumulado_2026]([Cuenta], [Nombre], [Mes], [Valor])
SELECT T1.[Account], T2.[AcctName],'SEPTIEMBRE' as Mes, Sum(T1.[Debit])- Sum(T1.[Credit]) as Valor
FROM [KELAB_ANALITICA_PROD].DBO.OJDT T0  INNER JOIN [KELAB_ANALITICA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <='2026/30/09' and  T1.Account >= 40000000
GROUP BY T1.[Account], T2.[AcctName]--, T1.[Debit], T1.[Credit]
ORDER BY T1.Account

INSERT 
INTO [dbo].[Kel_Balance_Acumulado_2026]([Cuenta], [Nombre], [Mes], [Valor])
SELECT T1.[Account], T2.[AcctName],'OCTUBRE' as Mes, Sum(T1.[Debit])- Sum(T1.[Credit]) as Valor
FROM [KELAB_ANALITICA_PROD].DBO.OJDT T0  INNER JOIN [KELAB_ANALITICA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <='2026/31/10' and  T1.Account >= 40000000
GROUP BY T1.[Account], T2.[AcctName]--, T1.[Debit], T1.[Credit]
ORDER BY T1.Account

INSERT 
INTO [dbo].[Kel_Balance_Acumulado_2026]([Cuenta], [Nombre], [Mes], [Valor])
SELECT T1.[Account], T2.[AcctName],'NOVIEMBRE' as Mes, Sum(T1.[Debit])- Sum(T1.[Credit]) as Valor
FROM [KELAB_ANALITICA_PROD].DBO.OJDT T0  INNER JOIN [KELAB_ANALITICA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <='2026/30/11' and  T1.Account >= 40000000
GROUP BY T1.[Account], T2.[AcctName]--, T1.[Debit], T1.[Credit]
ORDER BY T1.Account

INSERT 
INTO [dbo].[Kel_Balance_Acumulado_2026]([Cuenta], [Nombre], [Mes], [Valor])
SELECT T1.[Account], T2.[AcctName],'DICIEMBRE' as Mes, Sum(T1.[Debit])- Sum(T1.[Credit]) as Valor
FROM [KELAB_ANALITICA_PROD].DBO.OJDT T0  INNER JOIN [KELAB_ANALITICA_PROD].DBO.JDT1 T1 ON T0.[TransId] = T1.[TransId] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OACT T2 ON T1.[Account] = T2.[AcctCode] 
			  INNER JOIN [KELAB_ANALITICA_PROD].DBO.OCRD T3 ON T1.U_HBT_Tercero = T3.CardCode 
WHERE T0.[RefDate] >= '2026/01/01' and T0.[RefDate] <='2026/31/12' and  T1.Account >= 40000000
GROUP BY T1.[Account], T2.[AcctName]--, T1.[Debit], T1.[Credit]
ORDER BY T1.Account
