CC = gcc
CFLAGS = -Wall -Wextra -pthread -O2
TSAN_FLAGS = -Wall -Wextra -pthread -fsanitize=thread -g

all: bus

bus: bus.c
	$(CC) $(CFLAGS) bus.c -o bus

run: bus
	./bus 48 30 80

tsan: bus.c
	$(CC) $(TSAN_FLAGS) bus.c -o bus_tsan
	./bus_tsan 48 30 80

clean:
	rm -f bus bus_tsan