(module
    ;; CollisionHandler가 준비한 trusted-private enemy body와 candidate pair만 처리합니다.
    ;; part 원본은 f32로 읽고 JS Number와 같은 f64로 승격한 뒤 모든 산술을 수행합니다.
    (import "env" "memory" (memory 1))

    (func $is_finite
        (param $value f64)
        (result i32)
        (f64.eq
            (f64.sub (local.get $value) (local.get $value))
            (f64.const 0)))

    (func $is_valid_circle
        (param $x f64)
        (param $y f64)
        (param $radius f64)
        (result i32)
        (i32.and
            (i32.and
                (call $is_finite (local.get $x))
                (call $is_finite (local.get $y)))
            (i32.and
                (call $is_finite (local.get $radius))
                (f64.gt (local.get $radius) (f64.const 0)))))

    (func $is_memory_range_valid
        (param $base i32)
        (param $count i32)
        (param $stride i32)
        (result i32)
        (local $end i64)
        (local $memory_bytes i64)

        (if (i32.lt_s (local.get $count) (i32.const 0))
            (then (return (i32.const 0))))
        (local.set $end
            (i64.add
                (i64.extend_i32_u (local.get $base))
                (i64.mul
                    (i64.extend_i32_u (local.get $count))
                    (i64.extend_i32_u (local.get $stride)))))
        (local.set $memory_bytes
            (i64.shl
                (i64.extend_i32_u (memory.size))
                (i64.const 16)))
        (i64.le_u (local.get $end) (local.get $memory_bytes)))

    (func $is_part_span_valid
        (param $body i32)
        (param $total_part_count i32)
        (result i32)
        (local $start i32)
        (local $count i32)

        (local.set $start
            (i32.load offset=24 (local.get $body)))
        (local.set $count
            (i32.load offset=28 (local.get $body)))
        (i32.and
            (i32.le_u (local.get $start) (local.get $total_part_count))
            (i32.le_u
                (local.get $count)
                (i32.sub
                    (local.get $total_part_count)
                    (local.get $start)))))

    (func $detect_circle_overlap
        (param $ax f64)
        (param $ay f64)
        (param $ar f64)
        (param $bx f64)
        (param $by f64)
        (param $br f64)
        (result i32)
        (local $dx f64)
        (local $dy f64)
        (local $radius_sum f64)
        (local $dist_sq f64)

        (local.set $dx
            (f64.sub (local.get $bx) (local.get $ax)))
        (local.set $dy
            (f64.sub (local.get $by) (local.get $ay)))
        (local.set $radius_sum
            (f64.add (local.get $ar) (local.get $br)))
        (local.set $dist_sq
            (f64.add
                (f64.mul (local.get $dx) (local.get $dx))
                (f64.mul (local.get $dy) (local.get $dy))))
        (f64.lt
            (local.get $dist_sq)
            (f64.mul
                (local.get $radius_sum)
                (local.get $radius_sum))))

    (func $detect_aggregate_overlap
        (param $ax f64)
        (param $ay f64)
        (param $ar f64)
        (param $bx f64)
        (param $by f64)
        (param $br f64)
        (param $epsilon f64)
        (result i32)
        (local $dx f64)
        (local $dy f64)
        (local $radius_sum f64)
        (local $dist_sq f64)
        (local $distance f64)
        (local $penetration f64)

        (local.set $dx
            (f64.sub (local.get $bx) (local.get $ax)))
        (local.set $dy
            (f64.sub (local.get $by) (local.get $ay)))
        (local.set $radius_sum
            (f64.add (local.get $ar) (local.get $br)))
        (local.set $dist_sq
            (f64.add
                (f64.mul (local.get $dx) (local.get $dx))
                (f64.mul (local.get $dy) (local.get $dy))))
        (if
            (f64.ge
                (local.get $dist_sq)
                (f64.mul
                    (local.get $radius_sum)
                    (local.get $radius_sum)))
            (then (return (i32.const 0))))

        (local.set $distance
            (f64.sqrt (local.get $dist_sq)))
        (if
            (i32.eqz
                (f64.gt
                    (local.get $distance)
                    (local.get $epsilon)))
            (then
                (local.set $distance (f64.const 0))))
        (local.set $penetration
            (f64.sub
                (local.get $radius_sum)
                (local.get $distance)))
        (if (result i32)
            (call $is_finite (local.get $penetration))
            (then
                (f64.gt
                    (local.get $penetration)
                    (local.get $epsilon)))
            (else (i32.const 0))))

    (func $detect_circle_circle
        (param $body_a i32)
        (param $body_b i32)
        (param $radius_scale f64)
        (result i32)
        (local $ax f64)
        (local $ay f64)
        (local $ar f64)
        (local $bx f64)
        (local $by f64)
        (local $br f64)

        (local.set $ax (f64.load (local.get $body_a)))
        (local.set $ay (f64.load offset=8 (local.get $body_a)))
        (local.set $ar
            (f64.mul
                (f64.load offset=16 (local.get $body_a))
                (local.get $radius_scale)))
        (local.set $bx (f64.load (local.get $body_b)))
        (local.set $by (f64.load offset=8 (local.get $body_b)))
        (local.set $br
            (f64.mul
                (f64.load offset=16 (local.get $body_b))
                (local.get $radius_scale)))
        (if
            (i32.eqz
                (call $is_valid_circle
                    (local.get $ax)
                    (local.get $ay)
                    (local.get $ar)))
            (then (return (i32.const 0))))
        (if
            (i32.eqz
                (call $is_valid_circle
                    (local.get $bx)
                    (local.get $by)
                    (local.get $br)))
            (then (return (i32.const 0))))
        (call $detect_circle_overlap
            (local.get $ax)
            (local.get $ay)
            (local.get $ar)
            (local.get $bx)
            (local.get $by)
            (local.get $br)))

    (func $detect_parts_circle
        (param $parts_base i32)
        (param $part_body i32)
        (param $circle_body i32)
        (param $radius_scale f64)
        (param $epsilon f64)
        (result i32)
        (local $part_start i32)
        (local $part_count i32)
        (local $part_index i32)
        (local $part_address i32)
        (local $part_x f64)
        (local $part_y f64)
        (local $part_radius f64)
        (local $circle_x f64)
        (local $circle_y f64)
        (local $circle_radius f64)

        (local.set $part_start
            (i32.load offset=24 (local.get $part_body)))
        (local.set $part_count
            (i32.load offset=28 (local.get $part_body)))
        (local.set $circle_x
            (f64.load (local.get $circle_body)))
        (local.set $circle_y
            (f64.load offset=8 (local.get $circle_body)))
        (local.set $circle_radius
            (f64.mul
                (f64.load offset=16 (local.get $circle_body))
                (local.get $radius_scale)))
        (if
            (i32.eqz
                (call $is_valid_circle
                    (local.get $circle_x)
                    (local.get $circle_y)
                    (local.get $circle_radius)))
            (then (return (i32.const 0))))

        (local.set $part_index (i32.const 0))
        (block $parts_done
            (loop $parts_loop
                (br_if $parts_done
                    (i32.ge_u
                        (local.get $part_index)
                        (local.get $part_count)))
                (local.set $part_address
                    (i32.add
                        (local.get $parts_base)
                        (i32.mul
                            (i32.add
                                (local.get $part_start)
                                (local.get $part_index))
                            (i32.const 12))))
                (local.set $part_x
                    (f64.promote_f32
                        (f32.load (local.get $part_address))))
                (local.set $part_y
                    (f64.promote_f32
                        (f32.load offset=4 (local.get $part_address))))
                (local.set $part_radius
                    (f64.mul
                        (f64.promote_f32
                            (f32.load offset=8 (local.get $part_address)))
                        (local.get $radius_scale)))
                (if
                    (call $is_valid_circle
                        (local.get $part_x)
                        (local.get $part_y)
                        (local.get $part_radius))
                    (then
                        (if
                            (call $detect_aggregate_overlap
                                (local.get $part_x)
                                (local.get $part_y)
                                (local.get $part_radius)
                                (local.get $circle_x)
                                (local.get $circle_y)
                                (local.get $circle_radius)
                                (local.get $epsilon))
                            (then (return (i32.const 1))))))
                (local.set $part_index
                    (i32.add
                        (local.get $part_index)
                        (i32.const 1)))
                (br $parts_loop)))
        (i32.const 0))

    (func $detect_parts_parts
        (param $parts_base i32)
        (param $body_a i32)
        (param $body_b i32)
        (param $radius_scale f64)
        (param $epsilon f64)
        (result i32)
        (local $start_a i32)
        (local $count_a i32)
        (local $start_b i32)
        (local $count_b i32)
        (local $index_a i32)
        (local $index_b i32)
        (local $address_a i32)
        (local $address_b i32)
        (local $ax f64)
        (local $ay f64)
        (local $ar f64)
        (local $bx f64)
        (local $by f64)
        (local $br f64)

        (local.set $start_a
            (i32.load offset=24 (local.get $body_a)))
        (local.set $count_a
            (i32.load offset=28 (local.get $body_a)))
        (local.set $start_b
            (i32.load offset=24 (local.get $body_b)))
        (local.set $count_b
            (i32.load offset=28 (local.get $body_b)))
        (local.set $index_a (i32.const 0))
        (block $outer_done
            (loop $outer_loop
                (br_if $outer_done
                    (i32.ge_u
                        (local.get $index_a)
                        (local.get $count_a)))
                (local.set $address_a
                    (i32.add
                        (local.get $parts_base)
                        (i32.mul
                            (i32.add
                                (local.get $start_a)
                                (local.get $index_a))
                            (i32.const 12))))
                (local.set $ax
                    (f64.promote_f32
                        (f32.load (local.get $address_a))))
                (local.set $ay
                    (f64.promote_f32
                        (f32.load offset=4 (local.get $address_a))))
                (local.set $ar
                    (f64.mul
                        (f64.promote_f32
                            (f32.load offset=8 (local.get $address_a)))
                        (local.get $radius_scale)))
                (if
                    (call $is_valid_circle
                        (local.get $ax)
                        (local.get $ay)
                        (local.get $ar))
                    (then
                        (local.set $index_b (i32.const 0))
                        (block $inner_done
                            (loop $inner_loop
                                (br_if $inner_done
                                    (i32.ge_u
                                        (local.get $index_b)
                                        (local.get $count_b)))
                                (local.set $address_b
                                    (i32.add
                                        (local.get $parts_base)
                                        (i32.mul
                                            (i32.add
                                                (local.get $start_b)
                                                (local.get $index_b))
                                            (i32.const 12))))
                                (local.set $bx
                                    (f64.promote_f32
                                        (f32.load (local.get $address_b))))
                                (local.set $by
                                    (f64.promote_f32
                                        (f32.load offset=4 (local.get $address_b))))
                                (local.set $br
                                    (f64.mul
                                        (f64.promote_f32
                                            (f32.load offset=8 (local.get $address_b)))
                                        (local.get $radius_scale)))
                                (if
                                    (call $is_valid_circle
                                        (local.get $bx)
                                        (local.get $by)
                                        (local.get $br))
                                    (then
                                        (if
                                            (call $detect_aggregate_overlap
                                                (local.get $ax)
                                                (local.get $ay)
                                                (local.get $ar)
                                                (local.get $bx)
                                                (local.get $by)
                                                (local.get $br)
                                                (local.get $epsilon))
                                            (then (return (i32.const 1))))))
                                (local.set $index_b
                                    (i32.add
                                        (local.get $index_b)
                                        (i32.const 1)))
                                (br $inner_loop)))))
                (local.set $index_a
                    (i32.add
                        (local.get $index_a)
                        (i32.const 1)))
                (br $outer_loop)))
        (i32.const 0))

    (func (export "scan_contacts")
        (param $body_base i32)
        (param $body_count i32)
        (param $parts_base i32)
        (param $total_part_count i32)
        (param $pair_base i32)
        (param $pair_count i32)
        (param $result_base i32)
        (param $epsilon f64)
        (param $radius_scale f64)
        (result i32)
        (local $pair_index i32)
        (local $pair_address i32)
        (local $body_index_a i32)
        (local $body_index_b i32)
        (local $body_a i32)
        (local $body_b i32)
        (local $flags i32)
        (local $contact i32)

        (if
            (i32.or
                (i32.or
                    (i32.lt_s (local.get $body_count) (i32.const 0))
                    (i32.lt_s (local.get $total_part_count) (i32.const 0)))
                (i32.or
                    (i32.lt_s (local.get $pair_count) (i32.const 0))
                    (i32.eqz
                        (call $is_valid_circle
                            (f64.const 0)
                            (f64.const 0)
                            (local.get $epsilon)))))
            (then (return (i32.const 1))))
        (if
            (i32.eqz
                (call $is_valid_circle
                    (f64.const 0)
                    (f64.const 0)
                    (local.get $radius_scale)))
            (then (return (i32.const 1))))
        (if
            (i32.or
                (i32.or
                    (i32.ne
                        (i32.and (local.get $body_base) (i32.const 7))
                        (i32.const 0))
                    (i32.ne
                        (i32.and (local.get $parts_base) (i32.const 3))
                        (i32.const 0)))
                (i32.ne
                    (i32.and (local.get $pair_base) (i32.const 3))
                    (i32.const 0)))
            (then (return (i32.const 2))))
        (if
            (i32.eqz
                (call $is_memory_range_valid
                    (local.get $body_base)
                    (local.get $body_count)
                    (i32.const 32)))
            (then (return (i32.const 2))))
        (if
            (i32.eqz
                (call $is_memory_range_valid
                    (local.get $parts_base)
                    (local.get $total_part_count)
                    (i32.const 12)))
            (then (return (i32.const 2))))
        (if
            (i32.eqz
                (call $is_memory_range_valid
                    (local.get $pair_base)
                    (local.get $pair_count)
                    (i32.const 16)))
            (then (return (i32.const 2))))
        (if
            (i32.eqz
                (call $is_memory_range_valid
                    (local.get $result_base)
                    (local.get $pair_count)
                    (i32.const 1)))
            (then (return (i32.const 2))))

        (local.set $pair_index (i32.const 0))
        (block $pairs_done
            (loop $pairs_loop
                (br_if $pairs_done
                    (i32.ge_u
                        (local.get $pair_index)
                        (local.get $pair_count)))
                (local.set $pair_address
                    (i32.add
                        (local.get $pair_base)
                        (i32.shl
                            (local.get $pair_index)
                            (i32.const 4))))
                (local.set $body_index_a
                    (i32.load (local.get $pair_address)))
                (local.set $body_index_b
                    (i32.load offset=4 (local.get $pair_address)))
                (local.set $flags
                    (i32.load offset=8 (local.get $pair_address)))
                (if
                    (i32.or
                        (i32.or
                            (i32.ge_u
                                (local.get $body_index_a)
                                (local.get $body_count))
                            (i32.ge_u
                                (local.get $body_index_b)
                                (local.get $body_count)))
                        (i32.or
                            (i32.gt_u
                                (local.get $flags)
                                (i32.const 3))
                            (i32.ne
                                (i32.load offset=12 (local.get $pair_address))
                                (i32.const 0))))
                    (then (return (i32.const 3))))

                (local.set $body_a
                    (i32.add
                        (local.get $body_base)
                        (i32.shl
                            (local.get $body_index_a)
                            (i32.const 5))))
                (local.set $body_b
                    (i32.add
                        (local.get $body_base)
                        (i32.shl
                            (local.get $body_index_b)
                            (i32.const 5))))
                (if
                    (i32.and
                        (i32.ne
                            (i32.and (local.get $flags) (i32.const 1))
                            (i32.const 0))
                        (i32.eqz
                            (call $is_part_span_valid
                                (local.get $body_a)
                                (local.get $total_part_count))))
                    (then (return (i32.const 4))))
                (if
                    (i32.and
                        (i32.ne
                            (i32.and (local.get $flags) (i32.const 2))
                            (i32.const 0))
                        (i32.eqz
                            (call $is_part_span_valid
                                (local.get $body_b)
                                (local.get $total_part_count))))
                    (then (return (i32.const 4))))

                (local.set $contact
                    (if (result i32)
                        (i32.eq (local.get $flags) (i32.const 0))
                        (then
                            (call $detect_circle_circle
                                (local.get $body_a)
                                (local.get $body_b)
                                (local.get $radius_scale)))
                        (else
                            (if (result i32)
                                (i32.eq (local.get $flags) (i32.const 1))
                                (then
                                    (call $detect_parts_circle
                                        (local.get $parts_base)
                                        (local.get $body_a)
                                        (local.get $body_b)
                                        (local.get $radius_scale)
                                        (local.get $epsilon)))
                                (else
                                    (if (result i32)
                                        (i32.eq (local.get $flags) (i32.const 2))
                                        (then
                                            (call $detect_parts_circle
                                                (local.get $parts_base)
                                                (local.get $body_b)
                                                (local.get $body_a)
                                                (local.get $radius_scale)
                                                (local.get $epsilon)))
                                        (else
                                            (call $detect_parts_parts
                                                (local.get $parts_base)
                                                (local.get $body_a)
                                                (local.get $body_b)
                                                (local.get $radius_scale)
                                                (local.get $epsilon)))))))))
                (i32.store8
                    (i32.add
                        (local.get $result_base)
                        (local.get $pair_index))
                    (local.get $contact))
                (local.set $pair_index
                    (i32.add
                        (local.get $pair_index)
                        (i32.const 1)))
                (br $pairs_loop)))

        (i32.const 0))
)
