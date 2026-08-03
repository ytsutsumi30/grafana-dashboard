package com.example.androidvibrationdemo;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Deque;
import java.util.List;

public final class PersistentPayloadQueue {
    public interface StringStore {
        String get();

        void set(String value);
    }

    private final StringStore store;
    private final int capacity;
    private Deque<String> payloads;

    public PersistentPayloadQueue(StringStore store, int capacity) {
        if (store == null) {
            throw new IllegalArgumentException("store must not be null");
        }
        if (capacity <= 0) {
            throw new IllegalArgumentException("capacity must be greater than zero");
        }

        this.store = store;
        this.capacity = capacity;

        LoadResult result = deserialize(store.get());
        payloads = new ArrayDeque<>(result.payloads);
        boolean capped = false;
        while (payloads.size() > capacity) {
            payloads.removeFirst();
            capped = true;
        }
        if (result.corrupt || capped) {
            store.set(serialize(payloads));
        }
    }

    public synchronized void enqueue(String jsonPayload) {
        if (jsonPayload == null || jsonPayload.isEmpty()) {
            throw new IllegalArgumentException("jsonPayload must not be empty");
        }

        Deque<String> updated = new ArrayDeque<>(payloads);
        updated.addLast(jsonPayload);
        while (updated.size() > capacity) {
            updated.removeFirst();
        }
        persistAndReplace(updated);
    }

    public synchronized String peek() {
        return payloads.peekFirst();
    }

    public synchronized String remove() {
        if (payloads.isEmpty()) {
            return null;
        }

        Deque<String> updated = new ArrayDeque<>(payloads);
        String removed = updated.removeFirst();
        persistAndReplace(updated);
        return removed;
    }

    public synchronized int size() {
        return payloads.size();
    }

    private void persistAndReplace(Deque<String> updated) {
        store.set(serialize(updated));
        payloads = updated;
    }

    private static String serialize(Deque<String> values) {
        StringBuilder serialized = new StringBuilder();
        Base64.Encoder encoder = Base64.getEncoder();
        for (String value : values) {
            if (serialized.length() > 0) {
                serialized.append('\n');
            }
            serialized.append(encoder.encodeToString(value.getBytes(StandardCharsets.UTF_8)));
        }
        return serialized.toString();
    }

    private static LoadResult deserialize(String serialized) {
        List<String> values = new ArrayList<>();
        boolean corrupt = false;
        if (serialized == null || serialized.isEmpty()) {
            return new LoadResult(values, false);
        }

        Base64.Decoder decoder = Base64.getDecoder();
        String[] lines = serialized.split("\\r?\\n", -1);
        for (String line : lines) {
            if (line.isEmpty()) {
                corrupt = true;
                continue;
            }
            try {
                byte[] decoded = decoder.decode(line);
                String value = StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(decoded))
                        .toString();
                if (value.isEmpty()) {
                    corrupt = true;
                } else {
                    values.add(value);
                }
            } catch (IllegalArgumentException | CharacterCodingException exception) {
                corrupt = true;
            }
        }
        return new LoadResult(values, corrupt);
    }

    private static final class LoadResult {
        private final List<String> payloads;
        private final boolean corrupt;

        private LoadResult(List<String> payloads, boolean corrupt) {
            this.payloads = payloads;
            this.corrupt = corrupt;
        }
    }
}
