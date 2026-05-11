-- Correct pre-1877 Roosevelt document dates.
--
-- This library is for Roosevelt-attributed content. The earliest possible
-- Roosevelt publication represented here is the 1877 pamphlet "The Summer
-- Birds of the Adirondacks in Franklin County, N.Y."; older dates come from
-- source collection/range metadata and should not drive chronological views.

UPDATE documents
   SET date = '1877-01-01'
 WHERE date < '1877-01-01';
