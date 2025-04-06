def greet(name):
    message = "Hello, " + name + "!"
    print(message)
    return message

def main():
    result = greet("World")

if __name__ == "__main__":
    main()