package com.example.androidvibrationdemo;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.Test;

public final class PersistentPayloadQueueTest {
    @Test
    public void payloadsPersistAcrossQueueInstances() {
        MemoryStore store = new MemoryStore();
        PersistentPayloadQueue first = new PersistentPayloadQueue(store, 5);
        first.enqueue("{\"id\":1}");
        first.enqueue("{\"id\":2,\n\"status\":\"ready\"}");

        PersistentPayloadQueue restored = new PersistentPayloadQueue(store, 5);

        assertEquals(2, restored.size());
        assertEquals("{\"id\":1}", restored.remove());
        assertEquals("{\"id\":2,\n\"status\":\"ready\"}", restored.peek());
    }

    @Test
    public void removeUsesFifoOrder() {
        MemoryStore store = new MemoryStore();
        PersistentPayloadQueue queue = new PersistentPayloadQueue(store, 5);
        queue.enqueue("one");
        queue.enqueue("two");
        queue.enqueue("three");

        assertEquals("one", queue.peek());
        assertEquals("one", queue.remove());
        assertEquals("two", queue.remove());
        assertEquals("three", queue.remove());
        assertNull(queue.remove());
        assertEquals(0, queue.size());
    }

    @Test
    public void enqueueDropsOldestPayloadAtCapacity() {
        MemoryStore store = new MemoryStore();
        PersistentPayloadQueue queue = new PersistentPayloadQueue(store, 2);
        queue.enqueue("one");
        queue.enqueue("two");
        queue.enqueue("three");

        assertEquals(2, queue.size());
        assertEquals("two", queue.remove());
        assertEquals("three", queue.remove());
    }

    @Test
    public void corruptStorageIsSkippedAndRepaired() {
        String valid = Base64.getEncoder().encodeToString(
                "{\"valid\":true}".getBytes(StandardCharsets.UTF_8));
        String invalidUtf8 = Base64.getEncoder().encodeToString(new byte[] {(byte) 0xC3, 0x28});
        MemoryStore store = new MemoryStore(valid + "\nnot-base64!\n" + invalidUtf8 + "\n");

        PersistentPayloadQueue queue = new PersistentPayloadQueue(store, 5);

        assertEquals(1, queue.size());
        assertEquals("{\"valid\":true}", queue.peek());
        assertEquals(valid, store.value);

        PersistentPayloadQueue restored = new PersistentPayloadQueue(store, 5);
        assertEquals(1, restored.size());
        assertEquals("{\"valid\":true}", restored.peek());
    }

    @Test
    public void restoredPayloadsAreCappedFromTheOldest() {
        MemoryStore store = new MemoryStore();
        PersistentPayloadQueue largerQueue = new PersistentPayloadQueue(store, 4);
        largerQueue.enqueue("one");
        largerQueue.enqueue("two");
        largerQueue.enqueue("three");

        PersistentPayloadQueue smallerQueue = new PersistentPayloadQueue(store, 2);

        assertEquals("two", smallerQueue.remove());
        assertEquals("three", smallerQueue.remove());
        assertNull(smallerQueue.remove());
    }

    private static final class MemoryStore implements PersistentPayloadQueue.StringStore {
        private String value;

        private MemoryStore() {
            this("");
        }

        private MemoryStore(String value) {
            this.value = value;
        }

        @Override
        public String get() {
            return value;
        }

        @Override
        public void set(String value) {
            this.value = value;
        }
    }
}
