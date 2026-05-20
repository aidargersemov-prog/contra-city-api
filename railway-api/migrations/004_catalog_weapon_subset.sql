DELETE FROM catalog_items
WHERE item_type = 1
  AND item_id NOT IN (
    1, 2, 3, 4, 5, 6, 7,
    10, 72, 71,
    108, 105,
    101, 73, 80, 79,
    110, 67,
    109, 106,
    43, 44, 104, 59, 45,
    107, 103, 74, 75
  );
