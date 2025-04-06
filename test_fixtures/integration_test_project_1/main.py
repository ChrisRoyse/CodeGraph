from utils import add # Initial import for cross-lang test setup

def greet(name):
    print(f"Hello, {name}!")

if __name__ == "__main__":
    result = add(1, 2)
    greet("World")
    print(f"Result from TS: {result}")