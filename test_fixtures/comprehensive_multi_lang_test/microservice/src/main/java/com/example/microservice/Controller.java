// test_fixtures/comprehensive_multi_lang_test/microservice/src/main/java/com/example/microservice/Controller.java
package com.example.microservice;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;

import java.util.Map;
import java.util.HashMap;

// Interface for implementation example
interface ProcessingService {
    Map<String, Object> process(Map<String, Object> data);
}

@RestController
@RequestMapping("/internal") // Base path for endpoints in this controller
public class Controller implements ProcessingService { // Example implementation

    /**
     * Endpoint called by the Python backend (backend/app.py).
     * Demonstrates: BE (Python) -> Microservice (Java) interaction.
     *
     * @param data The data sent from the Python backend.
     * @return A response indicating processing status.
     */
    @PostMapping("/process") // Handles POST requests to /internal/process
    @Override // Implementing method from ProcessingService
    public Map<String, Object> process(@RequestBody Map<String, Object> data) {
        System.out.println("Java Microservice received data: " + data);

        // Simulate some processing
        String message = "Data processed successfully by Java Microservice.";
        boolean success = true;
        Object originalValue = data.getOrDefault("value", null);

        // Construct response
        Map<String, Object> response = new HashMap<>();
        response.put("status", success ? "processed" : "failed");
        response.put("message", message);
        response.put("originalValueReceived", originalValue);
        response.put("javaProcessedValue", "Java_" + originalValue); // Example transformation

        System.out.println("Java Microservice responding: " + response);
        // In Spring Boot, returning the Map automatically converts to JSON
        // with a 200 OK status by default.
        // For more control, you can return ResponseEntity:
        // return new ResponseEntity<>(response, HttpStatus.OK);
        return response;
    }

    // Example of another method in the controller
    public String getServiceStatus() {
        return "Microservice is running.";
    }
}

// Note: For this fixture, we don't need a full Spring Boot application runner,
// just the controller file to show the endpoint definition and structure.
// A real application would need a main class like:
/*
package com.example.microservice;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class MicroserviceApplication {
    public static void main(String[] args) {
        SpringApplication.run(MicroserviceApplication.class, args);
    }
}
*/