(module
    ;; JS 기준 구현과 같은 선형 메모리를 사용하는 단일 스레드 flow field 커널입니다.
    ;; 후보 비용·epsilon·방향 선택은 f64, heap 순서는 JS처럼 저장된 f32 비용으로 비교합니다.
    (import "env" "memory" (memory 1))

    (func $is_blocked
        (param $blocked_base i32)
        (param $cols i32)
        (param $rows i32)
        (param $cx i32)
        (param $cy i32)
        (result i32)
        (if (result i32)
            (i32.or
                (i32.or
                    (i32.lt_s (local.get $cx) (i32.const 0))
                    (i32.lt_s (local.get $cy) (i32.const 0)))
                (i32.or
                    (i32.ge_s (local.get $cx) (local.get $cols))
                    (i32.ge_s (local.get $cy) (local.get $rows))))
            (then
                (i32.const 1))
            (else
                (i32.load8_u
                    (i32.add
                        (local.get $blocked_base)
                        (i32.add
                            (i32.mul (local.get $cy) (local.get $cols))
                            (local.get $cx)))))))

    (func $dir_x
        (param $dir i32)
        (result i32)
        (if (result i32)
            (i32.lt_u (local.get $dir) (i32.const 4))
            (then
                (if (result i32)
                    (i32.eq (local.get $dir) (i32.const 0))
                    (then (i32.const 1))
                    (else
                        (if (result i32)
                            (i32.eq (local.get $dir) (i32.const 1))
                            (then (i32.const -1))
                            (else (i32.const 0))))))
            (else
                (if (result i32)
                    (i32.lt_u (local.get $dir) (i32.const 6))
                    (then (i32.const 1))
                    (else (i32.const -1))))))

    (func $dir_y
        (param $dir i32)
        (result i32)
        (if (result i32)
            (i32.lt_u (local.get $dir) (i32.const 2))
            (then (i32.const 0))
            (else
                (if (result i32)
                    (i32.lt_u (local.get $dir) (i32.const 4))
                    (then
                        (if (result i32)
                            (i32.eq (local.get $dir) (i32.const 2))
                            (then (i32.const 1))
                            (else (i32.const -1))))
                    (else
                        (if (result i32)
                            (i32.eqz (i32.and (local.get $dir) (i32.const 1)))
                            (then (i32.const 1))
                            (else (i32.const -1))))))))

    (func $dir_cost
        (param $dir i32)
        (result f64)
        (if (result f64)
            (i32.lt_u (local.get $dir) (i32.const 4))
            (then (f64.const 1))
            (else (f64.const 1.41421356237))))

    (func $is_heap_node_before
        (param $left_index i32)
        (param $right_index i32)
        (param $integration_base i32)
        (result i32)
        (local $left_cost f32)
        (local $right_cost f32)

        (local.set $left_cost
            (f32.load
                (i32.add
                    (local.get $integration_base)
                    (i32.shl (local.get $left_index) (i32.const 2)))))
        (local.set $right_cost
            (f32.load
                (i32.add
                    (local.get $integration_base)
                    (i32.shl (local.get $right_index) (i32.const 2)))))
        (if (result i32)
            (f32.lt (local.get $left_cost) (local.get $right_cost))
            (then (i32.const 1))
            (else
                (i32.and
                    (f32.eq (local.get $left_cost) (local.get $right_cost))
                    (i32.lt_u (local.get $left_index) (local.get $right_index))))))

    (func $push_heap_node
        (param $heap_base i32)
        (param $positions_base i32)
        (param $integration_base i32)
        (param $cell_index i32)
        (param $heap_count i32)
        (result i32)
        (local $position i32)
        (local $parent_position i32)
        (local $parent_index i32)

        (local.set $position (local.get $heap_count))
        (i32.store
            (i32.add
                (local.get $heap_base)
                (i32.shl (local.get $position) (i32.const 2)))
            (local.get $cell_index))
        (i32.store
            (i32.add
                (local.get $positions_base)
                (i32.shl (local.get $cell_index) (i32.const 2)))
            (local.get $position))

        (block $sift_done
            (loop $sift_up
                (br_if $sift_done
                    (i32.le_s (local.get $position) (i32.const 0)))
                (local.set $parent_position
                    (i32.shr_s
                        (i32.sub (local.get $position) (i32.const 1))
                        (i32.const 1)))
                (local.set $parent_index
                    (i32.load
                        (i32.add
                            (local.get $heap_base)
                            (i32.shl (local.get $parent_position) (i32.const 2)))))
                (br_if $sift_done
                    (i32.eqz
                        (call $is_heap_node_before
                            (local.get $cell_index)
                            (local.get $parent_index)
                            (local.get $integration_base))))
                (i32.store
                    (i32.add
                        (local.get $heap_base)
                        (i32.shl (local.get $position) (i32.const 2)))
                    (local.get $parent_index))
                (i32.store
                    (i32.add
                        (local.get $positions_base)
                        (i32.shl (local.get $parent_index) (i32.const 2)))
                    (local.get $position))
                (local.set $position (local.get $parent_position))
                (br $sift_up)))

        (i32.store
            (i32.add
                (local.get $heap_base)
                (i32.shl (local.get $position) (i32.const 2)))
            (local.get $cell_index))
        (i32.store
            (i32.add
                (local.get $positions_base)
                (i32.shl (local.get $cell_index) (i32.const 2)))
            (local.get $position))
        (i32.add (local.get $heap_count) (i32.const 1)))

    (func $decrease_heap_node
        (param $heap_base i32)
        (param $positions_base i32)
        (param $integration_base i32)
        (param $cell_index i32)
        (local $position i32)
        (local $parent_position i32)
        (local $parent_index i32)

        (local.set $position
            (i32.load
                (i32.add
                    (local.get $positions_base)
                    (i32.shl (local.get $cell_index) (i32.const 2)))))
        (if
            (i32.lt_s (local.get $position) (i32.const 0))
            (then (return)))

        (block $sift_done
            (loop $sift_up
                (br_if $sift_done
                    (i32.le_s (local.get $position) (i32.const 0)))
                (local.set $parent_position
                    (i32.shr_s
                        (i32.sub (local.get $position) (i32.const 1))
                        (i32.const 1)))
                (local.set $parent_index
                    (i32.load
                        (i32.add
                            (local.get $heap_base)
                            (i32.shl (local.get $parent_position) (i32.const 2)))))
                (br_if $sift_done
                    (i32.eqz
                        (call $is_heap_node_before
                            (local.get $cell_index)
                            (local.get $parent_index)
                            (local.get $integration_base))))
                (i32.store
                    (i32.add
                        (local.get $heap_base)
                        (i32.shl (local.get $position) (i32.const 2)))
                    (local.get $parent_index))
                (i32.store
                    (i32.add
                        (local.get $positions_base)
                        (i32.shl (local.get $parent_index) (i32.const 2)))
                    (local.get $position))
                (local.set $position (local.get $parent_position))
                (br $sift_up)))

        (i32.store
            (i32.add
                (local.get $heap_base)
                (i32.shl (local.get $position) (i32.const 2)))
            (local.get $cell_index))
        (i32.store
            (i32.add
                (local.get $positions_base)
                (i32.shl (local.get $cell_index) (i32.const 2)))
            (local.get $position)))

    (func $pop_heap_node
        (param $heap_base i32)
        (param $positions_base i32)
        (param $integration_base i32)
        (param $heap_count i32)
        (result i32)
        (local $root_index i32)
        (local $last_index i32)
        (local $remaining_count i32)
        (local $position i32)
        (local $left_position i32)
        (local $right_position i32)
        (local $next_position i32)
        (local $next_index i32)

        (local.set $root_index (i32.load (local.get $heap_base)))
        (local.set $remaining_count
            (i32.sub (local.get $heap_count) (i32.const 1)))
        (local.set $last_index
            (i32.load
                (i32.add
                    (local.get $heap_base)
                    (i32.shl (local.get $remaining_count) (i32.const 2)))))
        (i32.store
            (i32.add
                (local.get $positions_base)
                (i32.shl (local.get $root_index) (i32.const 2)))
            (i32.const -1))
        (if
            (i32.eqz (local.get $remaining_count))
            (then (return (local.get $root_index))))

        (local.set $position (i32.const 0))
        (i32.store (local.get $heap_base) (local.get $last_index))
        (i32.store
            (i32.add
                (local.get $positions_base)
                (i32.shl (local.get $last_index) (i32.const 2)))
            (i32.const 0))

        (block $sift_done
            (loop $sift_down
                (local.set $left_position
                    (i32.add
                        (i32.mul (local.get $position) (i32.const 2))
                        (i32.const 1)))
                (br_if $sift_done
                    (i32.ge_u (local.get $left_position) (local.get $remaining_count)))
                (local.set $right_position
                    (i32.add (local.get $left_position) (i32.const 1)))
                (local.set $next_position (local.get $left_position))
                (if
                    (i32.and
                        (i32.lt_u (local.get $right_position) (local.get $remaining_count))
                        (call $is_heap_node_before
                            (i32.load
                                (i32.add
                                    (local.get $heap_base)
                                    (i32.shl (local.get $right_position) (i32.const 2))))
                            (i32.load
                                (i32.add
                                    (local.get $heap_base)
                                    (i32.shl (local.get $left_position) (i32.const 2))))
                            (local.get $integration_base)))
                    (then
                        (local.set $next_position (local.get $right_position))))
                (local.set $next_index
                    (i32.load
                        (i32.add
                            (local.get $heap_base)
                            (i32.shl (local.get $next_position) (i32.const 2)))))
                (br_if $sift_done
                    (i32.eqz
                        (call $is_heap_node_before
                            (local.get $next_index)
                            (local.get $last_index)
                            (local.get $integration_base))))
                (i32.store
                    (i32.add
                        (local.get $heap_base)
                        (i32.shl (local.get $position) (i32.const 2)))
                    (local.get $next_index))
                (i32.store
                    (i32.add
                        (local.get $positions_base)
                        (i32.shl (local.get $next_index) (i32.const 2)))
                    (local.get $position))
                (local.set $position (local.get $next_position))
                (br $sift_down)))

        (i32.store
            (i32.add
                (local.get $heap_base)
                (i32.shl (local.get $position) (i32.const 2)))
            (local.get $last_index))
        (i32.store
            (i32.add
                (local.get $positions_base)
                (i32.shl (local.get $last_index) (i32.const 2)))
            (local.get $position))
        (local.get $root_index))

    (func (export "build_flow_field")
        (param $blocked_base i32)
        (param $integration_base i32)
        (param $dir_x_base i32)
        (param $dir_y_base i32)
        (param $heap_base i32)
        (param $positions_base i32)
        (param $cols i32)
        (param $rows i32)
        (param $goal_cx i32)
        (param $goal_cy i32)
        (result i32)
        (local $size i32)
        (local $index i32)
        (local $goal_index i32)
        (local $heap_count i32)
        (local $best_index i32)
        (local $cell_cx i32)
        (local $cell_cy i32)
        (local $dir i32)
        (local $dx i32)
        (local $dy i32)
        (local $nx i32)
        (local $ny i32)
        (local $neighbor_index i32)
        (local $candidate f64)
        (local $best_neighbor_index i32)
        (local $best_cost f64)
        (local $neighbor_cost f64)
        (local $length f64)

        (if
            (i32.or
                (i32.le_s (local.get $cols) (i32.const 0))
                (i32.le_s (local.get $rows) (i32.const 0)))
            (then (return (i32.const 1))))
        (if
            (i32.or
                (i32.or
                    (i32.lt_s (local.get $goal_cx) (i32.const 0))
                    (i32.lt_s (local.get $goal_cy) (i32.const 0)))
                (i32.or
                    (i32.ge_s (local.get $goal_cx) (local.get $cols))
                    (i32.ge_s (local.get $goal_cy) (local.get $rows))))
            (then (return (i32.const 1))))

        (local.set $size (i32.mul (local.get $cols) (local.get $rows)))
        (if
            (i32.le_s (local.get $size) (i32.const 0))
            (then (return (i32.const 2))))

        (local.set $index (i32.const 0))
        (block $initialize_done
            (loop $initialize
                (br_if $initialize_done
                    (i32.ge_u (local.get $index) (local.get $size)))
                (f32.store
                    (i32.add
                        (local.get $integration_base)
                        (i32.shl (local.get $index) (i32.const 2)))
                    (f32.const 1e20))
                (f32.store
                    (i32.add
                        (local.get $dir_x_base)
                        (i32.shl (local.get $index) (i32.const 2)))
                    (f32.const 0))
                (f32.store
                    (i32.add
                        (local.get $dir_y_base)
                        (i32.shl (local.get $index) (i32.const 2)))
                    (f32.const 0))
                (i32.store
                    (i32.add
                        (local.get $positions_base)
                        (i32.shl (local.get $index) (i32.const 2)))
                    (i32.const -1))
                (local.set $index
                    (i32.add (local.get $index) (i32.const 1)))
                (br $initialize)))

        (local.set $goal_index
            (i32.add
                (i32.mul (local.get $goal_cy) (local.get $cols))
                (local.get $goal_cx)))
        (f32.store
            (i32.add
                (local.get $integration_base)
                (i32.shl (local.get $goal_index) (i32.const 2)))
            (f32.const 0))
        (local.set $heap_count
            (call $push_heap_node
                (local.get $heap_base)
                (local.get $positions_base)
                (local.get $integration_base)
                (local.get $goal_index)
                (i32.const 0)))

        (block $search_done
            (loop $search
                (br_if $search_done (i32.eqz (local.get $heap_count)))
                (local.set $best_index
                    (call $pop_heap_node
                        (local.get $heap_base)
                        (local.get $positions_base)
                        (local.get $integration_base)
                        (local.get $heap_count)))
                (local.set $heap_count
                    (i32.sub (local.get $heap_count) (i32.const 1)))
                (local.set $cell_cx
                    (i32.rem_u (local.get $best_index) (local.get $cols)))
                (local.set $cell_cy
                    (i32.div_u (local.get $best_index) (local.get $cols)))
                (local.set $dir (i32.const 0))

                (block $search_directions_done
                    (loop $search_directions
                        (br_if $search_directions_done
                            (i32.ge_u (local.get $dir) (i32.const 8)))
                        (local.set $dx (call $dir_x (local.get $dir)))
                        (local.set $dy (call $dir_y (local.get $dir)))
                        (local.set $nx
                            (i32.add (local.get $cell_cx) (local.get $dx)))
                        (local.set $ny
                            (i32.add (local.get $cell_cy) (local.get $dy)))

                        (block $next_search_direction
                            (br_if $next_search_direction
                                (call $is_blocked
                                    (local.get $blocked_base)
                                    (local.get $cols)
                                    (local.get $rows)
                                    (local.get $nx)
                                    (local.get $ny)))
                            (if
                                (i32.and
                                    (i32.ne (local.get $dx) (i32.const 0))
                                    (i32.ne (local.get $dy) (i32.const 0)))
                                (then
                                    (br_if $next_search_direction
                                        (call $is_blocked
                                            (local.get $blocked_base)
                                            (local.get $cols)
                                            (local.get $rows)
                                            (i32.add (local.get $cell_cx) (local.get $dx))
                                            (local.get $cell_cy)))
                                    (br_if $next_search_direction
                                        (call $is_blocked
                                            (local.get $blocked_base)
                                            (local.get $cols)
                                            (local.get $rows)
                                            (local.get $cell_cx)
                                            (i32.add (local.get $cell_cy) (local.get $dy))))))

                            (local.set $neighbor_index
                                (i32.add
                                    (i32.mul (local.get $ny) (local.get $cols))
                                    (local.get $nx)))
                            (local.set $candidate
                                (f64.add
                                    (f64.promote_f32
                                        (f32.load
                                            (i32.add
                                                (local.get $integration_base)
                                                (i32.shl
                                                    (local.get $best_index)
                                                    (i32.const 2)))))
                                    (call $dir_cost (local.get $dir))))
                            (br_if $next_search_direction
                                (f64.ge
                                    (f64.add
                                        (local.get $candidate)
                                        (f64.const 0.000001))
                                    (f64.promote_f32
                                        (f32.load
                                            (i32.add
                                                (local.get $integration_base)
                                                (i32.shl
                                                    (local.get $neighbor_index)
                                                    (i32.const 2)))))))
                            (f32.store
                                (i32.add
                                    (local.get $integration_base)
                                    (i32.shl
                                        (local.get $neighbor_index)
                                        (i32.const 2)))
                                (f32.demote_f64 (local.get $candidate)))

                            (if
                                (i32.lt_s
                                    (i32.load
                                        (i32.add
                                            (local.get $positions_base)
                                            (i32.shl
                                                (local.get $neighbor_index)
                                                (i32.const 2))))
                                    (i32.const 0))
                                (then
                                    (local.set $heap_count
                                        (call $push_heap_node
                                            (local.get $heap_base)
                                            (local.get $positions_base)
                                            (local.get $integration_base)
                                            (local.get $neighbor_index)
                                            (local.get $heap_count))))
                                (else
                                    (call $decrease_heap_node
                                        (local.get $heap_base)
                                        (local.get $positions_base)
                                        (local.get $integration_base)
                                        (local.get $neighbor_index)))))

                        (local.set $dir
                            (i32.add (local.get $dir) (i32.const 1)))
                        (br $search_directions)))
                (br $search)))

        (local.set $cell_cy (i32.const 0))
        (block $rows_done
            (loop $rows_loop
                (br_if $rows_done
                    (i32.ge_u (local.get $cell_cy) (local.get $rows)))
                (local.set $cell_cx (i32.const 0))
                (block $cols_done
                    (loop $cols_loop
                        (br_if $cols_done
                            (i32.ge_u (local.get $cell_cx) (local.get $cols)))
                        (local.set $index
                            (i32.add
                                (i32.mul (local.get $cell_cy) (local.get $cols))
                                (local.get $cell_cx)))

                        (block $next_cell
                            (br_if $next_cell
                                (i32.load8_u
                                    (i32.add
                                        (local.get $blocked_base)
                                        (local.get $index))))
                            (br_if $next_cell
                                (f64.ge
                                    (f64.promote_f32
                                        (f32.load
                                            (i32.add
                                                (local.get $integration_base)
                                                (i32.shl
                                                    (local.get $index)
                                                    (i32.const 2)))))
                                    (f64.const 5e19)))

                            (local.set $best_neighbor_index (local.get $index))
                            (local.set $best_cost
                                (f64.promote_f32
                                    (f32.load
                                        (i32.add
                                            (local.get $integration_base)
                                            (i32.shl
                                                (local.get $index)
                                                (i32.const 2))))))
                            (local.set $dir (i32.const 0))

                            (block $field_directions_done
                                (loop $field_directions
                                    (br_if $field_directions_done
                                        (i32.ge_u (local.get $dir) (i32.const 8)))
                                    (local.set $dx (call $dir_x (local.get $dir)))
                                    (local.set $dy (call $dir_y (local.get $dir)))
                                    (local.set $nx
                                        (i32.add (local.get $cell_cx) (local.get $dx)))
                                    (local.set $ny
                                        (i32.add (local.get $cell_cy) (local.get $dy)))

                                    (block $next_field_direction
                                        (br_if $next_field_direction
                                            (call $is_blocked
                                                (local.get $blocked_base)
                                                (local.get $cols)
                                                (local.get $rows)
                                                (local.get $nx)
                                                (local.get $ny)))
                                        (if
                                            (i32.and
                                                (i32.ne (local.get $dx) (i32.const 0))
                                                (i32.ne (local.get $dy) (i32.const 0)))
                                            (then
                                                (br_if $next_field_direction
                                                    (call $is_blocked
                                                        (local.get $blocked_base)
                                                        (local.get $cols)
                                                        (local.get $rows)
                                                        (i32.add
                                                            (local.get $cell_cx)
                                                            (local.get $dx))
                                                        (local.get $cell_cy)))
                                                (br_if $next_field_direction
                                                    (call $is_blocked
                                                        (local.get $blocked_base)
                                                        (local.get $cols)
                                                        (local.get $rows)
                                                        (local.get $cell_cx)
                                                        (i32.add
                                                            (local.get $cell_cy)
                                                            (local.get $dy))))))

                                        (local.set $neighbor_index
                                            (i32.add
                                                (i32.mul
                                                    (local.get $ny)
                                                    (local.get $cols))
                                                (local.get $nx)))
                                        (local.set $neighbor_cost
                                            (f64.promote_f32
                                                (f32.load
                                                    (i32.add
                                                        (local.get $integration_base)
                                                        (i32.shl
                                                            (local.get $neighbor_index)
                                                            (i32.const 2))))))
                                        (if
                                            (f64.lt
                                                (f64.add
                                                    (local.get $neighbor_cost)
                                                    (f64.const 0.000001))
                                                (local.get $best_cost))
                                            (then
                                                (local.set $best_cost
                                                    (local.get $neighbor_cost))
                                                (local.set $best_neighbor_index
                                                    (local.get $neighbor_index)))))

                                    (local.set $dir
                                        (i32.add (local.get $dir) (i32.const 1)))
                                    (br $field_directions)))

                            (br_if $next_cell
                                (i32.eq
                                    (local.get $best_neighbor_index)
                                    (local.get $index)))
                            (local.set $nx
                                (i32.sub
                                    (i32.rem_u
                                        (local.get $best_neighbor_index)
                                        (local.get $cols))
                                    (local.get $cell_cx)))
                            (local.set $ny
                                (i32.sub
                                    (i32.div_u
                                        (local.get $best_neighbor_index)
                                        (local.get $cols))
                                    (local.get $cell_cy)))
                            (local.set $length
                                (f64.sqrt
                                    (f64.add
                                        (f64.mul
                                            (f64.convert_i32_s (local.get $nx))
                                            (f64.convert_i32_s (local.get $nx)))
                                        (f64.mul
                                            (f64.convert_i32_s (local.get $ny))
                                            (f64.convert_i32_s (local.get $ny))))))
                            (br_if $next_cell
                                (f64.le
                                    (local.get $length)
                                    (f64.const 0.000001)))
                            (f32.store
                                (i32.add
                                    (local.get $dir_x_base)
                                    (i32.shl (local.get $index) (i32.const 2)))
                                (f32.demote_f64
                                    (f64.div
                                        (f64.convert_i32_s (local.get $nx))
                                        (local.get $length))))
                            (f32.store
                                (i32.add
                                    (local.get $dir_y_base)
                                    (i32.shl (local.get $index) (i32.const 2)))
                                (f32.demote_f64
                                    (f64.div
                                        (f64.convert_i32_s (local.get $ny))
                                        (local.get $length)))))

                        (local.set $cell_cx
                            (i32.add (local.get $cell_cx) (i32.const 1)))
                        (br $cols_loop)))
                (local.set $cell_cy
                    (i32.add (local.get $cell_cy) (i32.const 1)))
                (br $rows_loop)))

        (i32.const 0))
)
