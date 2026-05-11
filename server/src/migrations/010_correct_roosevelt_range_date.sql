-- Correct the first Series 1 LoC item date.
--
-- The LoC source record mss382990001 is a reel/range record whose metadata
-- begins with pre-Roosevelt related material (1759, Aug.-1898, May). For the
-- library timeline, the meaningful earliest TR-authored work in that range is
-- the 1877 pamphlet "The Summer Birds of the Adirondacks in Franklin County,
-- N.Y.", so already-ingested databases should not plot this item in 1759.

UPDATE documents
   SET date = '1877-01-01'
 WHERE id = 'loc-mss382990001'
   AND date < '1877-01-01';
